import { describe, expect, it, vi } from "vitest";
import type { McpOAuth2AuthConfig } from "../src/contracts/capability";
import {
  buildMcpOAuthAuthorizationUrl,
  createMcpOAuthPkce,
  decryptMcpOAuthToken,
  discoverMcpOAuthMetadata,
  encryptMcpOAuthToken,
  exchangeMcpOAuthCode,
  hasRequiredOAuthScopes,
  isSafeOAuthIssuer,
  MCP_OAUTH_CALLBACK_PATH,
  refreshMcpOAuthToken,
} from "../src/services/mcp-oauth";

const auth: McpOAuth2AuthConfig = {
  version: 1,
  type: "oauth2",
  issuer: "https://issuer.example",
  clientId: "chatus-client",
  scopes: ["files.read", "profile"],
  callbackPath: MCP_OAUTH_CALLBACK_PATH,
  configRevision: "a".repeat(64),
};

describe("MCP OAuth", () => {
  it("creates PKCE S256 values and a fixed-callback authorization URL", async () => {
    const pkce = await createMcpOAuthPkce();
    const expectedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pkce.verifier));
    expect(pkce.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(base64Url(new Uint8Array(expectedDigest)));

    const authorizeUrl = new URL(buildMcpOAuthAuthorizationUrl({
      metadata: {
        issuer: auth.issuer,
        authorizationEndpoint: "https://issuer.example/authorize",
        tokenEndpoint: "https://issuer.example/token",
      },
      auth,
      callbackUrl: `https://chat.example${MCP_OAUTH_CALLBACK_PATH}`,
      state: pkce.state,
      challenge: pkce.challenge,
    }));
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://issuer.example/authorize");
    expect(Object.fromEntries(authorizeUrl.searchParams)).toMatchObject({
      response_type: "code",
      client_id: auth.clientId,
      redirect_uri: `https://chat.example${MCP_OAUTH_CALLBACK_PATH}`,
      scope: "files.read profile",
      state: pkce.state,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
  });

  it("discovers same-origin metadata and exchanges a code without redirects", async () => {
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/.well-known/oauth-authorization-server")) {
        return Response.json({
          issuer: auth.issuer,
          authorization_endpoint: "https://issuer.example/authorize",
          token_endpoint: "https://issuer.example/token",
          code_challenge_methods_supported: ["S256"],
        });
      }
      expect(request.headers.get("Authorization")).toBeNull();
      expect(new TextDecoder().decode(await request.arrayBuffer())).toContain("code_verifier=fixture-verifier");
      return Response.json({
        access_token: "member-access-token",
        refresh_token: "member-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "profile files.read",
      });
    });

    const metadata = await discoverMcpOAuthMetadata(auth, fetcher);
    const token = await exchangeMcpOAuthCode({
      metadata,
      auth,
      callbackUrl: `https://chat.example${MCP_OAUTH_CALLBACK_PATH}`,
      code: "fixture-code",
      verifier: "fixture-verifier",
      now: 1_000,
      fetch: fetcher,
    });

    expect(token).toEqual({
      accessToken: "member-access-token",
      refreshToken: "member-refresh-token",
      expiresAt: 3_601_000,
      grantedScopes: ["files.read", "profile"],
      issuer: auth.issuer,
      clientId: auth.clientId,
      configRevision: auth.configRevision,
    });
    expect(requests).toHaveLength(2);
  });

  it("refreshes with client authentication, retains a rotated-or-existing refresh token, and rejects invalid_grant", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get("Authorization")).toMatch(/^Basic /);
      expect(new TextDecoder().decode(await request.arrayBuffer())).toBe("grant_type=refresh_token&refresh_token=refresh-old");
      return Response.json({ access_token: "access-next", token_type: "bearer", expires_in: 60 });
    });
    const metadata = {
      issuer: auth.issuer,
      authorizationEndpoint: "https://issuer.example/authorize",
      tokenEndpoint: "https://issuer.example/token",
    };
    const refreshed = await refreshMcpOAuthToken({
      metadata,
      auth,
      refreshToken: "refresh-old",
      previousScopes: auth.scopes,
      clientSecret: "client-secret",
      now: 2_000,
      fetch: fetcher,
    });
    expect(refreshed).toMatchObject({
      accessToken: "access-next",
      refreshToken: "refresh-old",
      expiresAt: 62_000,
      grantedScopes: auth.scopes,
    });

    await expect(refreshMcpOAuthToken({
      metadata,
      auth,
      refreshToken: "expired-refresh",
      previousScopes: auth.scopes,
      fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    })).rejects.toMatchObject({ code: "mcp_oauth_invalid_grant", retryable: false });
  });

  it("encrypts tokens with member/server AAD and fails closed across either boundary", async () => {
    const token = {
      accessToken: "private-access-token",
      refreshToken: "private-refresh-token",
      expiresAt: 10_000,
      grantedScopes: auth.scopes,
      issuer: auth.issuer,
      clientId: auth.clientId,
      configRevision: auth.configRevision,
    };
    const record = await encryptMcpOAuthToken({
      masterKey: masterKey(7),
      ownerLabel: "alice",
      serverId: "docs",
      token,
      nowIso: "2026-08-01T00:00:00.000Z",
    });
    expect(JSON.stringify(record)).not.toContain("private-access-token");
    await expect(decryptMcpOAuthToken({
      masterKey: masterKey(7),
      ownerLabel: "alice",
      serverId: "docs",
      record,
    })).resolves.toEqual(token);
    await expect(decryptMcpOAuthToken({
      masterKey: masterKey(7),
      ownerLabel: "bob",
      serverId: "docs",
      record,
    })).rejects.toMatchObject({ code: "mcp_oauth_token_unavailable" });
    await expect(decryptMcpOAuthToken({
      masterKey: masterKey(7),
      ownerLabel: "alice",
      serverId: "other",
      record,
    })).rejects.toMatchObject({ code: "mcp_oauth_token_unavailable" });
  });

  it("rejects private issuers, cross-origin endpoints, redirects, and missing granted scopes", async () => {
    expect(isSafeOAuthIssuer("https://issuer.example/tenant")).toBe(true);
    expect(isSafeOAuthIssuer("http://issuer.example")).toBe(false);
    expect(isSafeOAuthIssuer("https://localhost/oauth")).toBe(false);
    expect(isSafeOAuthIssuer("https://127.0.0.1/oauth")).toBe(false);
    expect(hasRequiredOAuthScopes(["profile"], auth.scopes)).toBe(false);

    await expect(discoverMcpOAuthMetadata(auth, async () => Response.json({
      issuer: auth.issuer,
      authorization_endpoint: "https://attacker.example/authorize",
      token_endpoint: "https://issuer.example/token",
    }))).rejects.toMatchObject({ code: "mcp_oauth_metadata_unavailable" });
    await expect(discoverMcpOAuthMetadata(auth, async () => new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.example" },
    }))).rejects.toMatchObject({ code: "mcp_oauth_metadata_unavailable" });
  });
});

function masterKey(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
