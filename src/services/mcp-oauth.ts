import type { McpOAuth2AuthConfig } from "../contracts/capability";

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";
export const MCP_OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;

const MAX_OAUTH_RESPONSE_BYTES = 64 * 1_024;
const MAX_OAUTH_TOKEN_CHARS = 8_192;
const MAX_OAUTH_SCOPES = 32;
const MAX_OAUTH_SCOPE_CHARS = 120;

export type McpOAuthMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
};

export type McpOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  grantedScopes: string[];
  issuer: string;
  clientId: string;
  configRevision: string;
};

export type EncryptedMcpOAuthToken = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  updatedAt: string;
};

export type McpOAuthPkce = {
  state: string;
  verifier: string;
  challenge: string;
};

export class McpOAuthError extends Error {
  constructor(
    readonly code:
      | "mcp_oauth_config_invalid"
      | "mcp_oauth_metadata_unavailable"
      | "mcp_oauth_exchange_failed"
      | "mcp_oauth_invalid_grant"
      | "mcp_oauth_token_invalid"
      | "mcp_oauth_token_unavailable"
      | "mcp_oauth_review_required",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}

export async function createMcpOAuthPkce(): Promise<McpOAuthPkce> {
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { state, verifier, challenge: bytesToBase64Url(new Uint8Array(digest)) };
}

export function buildMcpOAuthAuthorizationUrl(args: {
  metadata: McpOAuthMetadata;
  auth: McpOAuth2AuthConfig;
  callbackUrl: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(args.metadata.authorizationEndpoint);
  url.search = "";
  url.hash = "";
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.auth.clientId);
  url.searchParams.set("redirect_uri", args.callbackUrl);
  url.searchParams.set("scope", args.auth.scopes.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function discoverMcpOAuthMetadata(
  auth: McpOAuth2AuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<McpOAuthMetadata> {
  const issuer = requireSafeOAuthUrl(auth.issuer, "issuer");
  const metadataUrl = oauthMetadataUrl(issuer);
  const response = await safeOAuthFetch(metadataUrl, { method: "GET" }, issuer.origin, fetcher);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new McpOAuthError("mcp_oauth_metadata_unavailable", "OAuth 元数据暂时不可用", true);
  }
  const payload = await readBoundedJson(response);
  if (!isRecord(payload) || payload.issuer !== issuer.toString().replace(/\/$/, "")) {
    throw new McpOAuthError("mcp_oauth_metadata_unavailable", "OAuth 元数据 issuer 不匹配");
  }
  const authorizationEndpoint = requireSameOriginOAuthEndpoint(payload.authorization_endpoint, issuer);
  const tokenEndpoint = requireSameOriginOAuthEndpoint(payload.token_endpoint, issuer);
  const methods = payload.code_challenge_methods_supported;
  if (methods !== undefined && (!Array.isArray(methods) || !methods.includes("S256"))) {
    throw new McpOAuthError("mcp_oauth_metadata_unavailable", "OAuth 服务不支持 PKCE S256");
  }
  return { issuer: issuer.toString().replace(/\/$/, ""), authorizationEndpoint, tokenEndpoint };
}

export async function exchangeMcpOAuthCode(args: {
  metadata: McpOAuthMetadata;
  auth: McpOAuth2AuthConfig;
  callbackUrl: string;
  code: string;
  verifier: string;
  clientSecret?: string;
  now?: number;
  fetch?: typeof fetch;
}): Promise<McpOAuthTokenSet> {
  return requestToken({
    metadata: args.metadata,
    auth: args.auth,
    clientSecret: args.clientSecret,
    now: args.now,
    fetch: args.fetch,
    form: {
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.callbackUrl,
      code_verifier: args.verifier,
    },
  });
}

export async function refreshMcpOAuthToken(args: {
  metadata: McpOAuthMetadata;
  auth: McpOAuth2AuthConfig;
  refreshToken: string;
  previousScopes: string[];
  clientSecret?: string;
  now?: number;
  fetch?: typeof fetch;
}): Promise<McpOAuthTokenSet> {
  return requestToken({
    metadata: args.metadata,
    auth: args.auth,
    clientSecret: args.clientSecret,
    now: args.now,
    fetch: args.fetch,
    previousRefreshToken: args.refreshToken,
    fallbackScopes: args.previousScopes,
    form: { grant_type: "refresh_token", refresh_token: args.refreshToken },
  });
}

export async function encryptMcpOAuthToken(args: {
  masterKey?: string;
  ownerLabel: string;
  serverId: string;
  token: McpOAuthTokenSet;
  nowIso?: string;
}): Promise<EncryptedMcpOAuthToken> {
  const key = await importMasterKey(args.masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: tokenAdditionalData(args.ownerLabel, args.serverId) },
    key,
    new TextEncoder().encode(JSON.stringify(args.token)),
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: args.nowIso || new Date().toISOString(),
  };
}

export async function decryptMcpOAuthToken(args: {
  masterKey?: string;
  ownerLabel: string;
  serverId: string;
  record: EncryptedMcpOAuthToken;
}): Promise<McpOAuthTokenSet> {
  const record = normalizeEncryptedMcpOAuthToken(args.record);
  const key = await importMasterKey(args.masterKey);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.iv),
        additionalData: tokenAdditionalData(args.ownerLabel, args.serverId),
      },
      key,
      base64ToBytes(record.ciphertext),
    );
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext));
    return normalizeTokenSet(parsed);
  } catch (error) {
    if (error instanceof McpOAuthError) throw error;
    throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接无法解密，请重新连接");
  }
}

export function normalizeEncryptedMcpOAuthToken(value: unknown): EncryptedMcpOAuthToken {
  if (
    !isRecord(value)
    || value.version !== 1
    || value.algorithm !== "AES-GCM"
    || typeof value.iv !== "string"
    || typeof value.ciphertext !== "string"
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接记录无效，请重新连接");
  }
  try {
    if (base64ToBytes(value.iv).byteLength !== 12 || base64ToBytes(value.ciphertext).byteLength < 16) {
      throw new Error("invalid encrypted OAuth token");
    }
  } catch {
    throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接记录无效，请重新连接");
  }
  return value as EncryptedMcpOAuthToken;
}

export function normalizeOAuthScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const scope = item.trim();
    if (!scope || scope.length > MAX_OAUTH_SCOPE_CHARS || /\s/.test(scope) || output.includes(scope)) continue;
    output.push(scope);
    if (output.length >= MAX_OAUTH_SCOPES) break;
  }
  return output.sort(codeUnitCompare);
}

export function hasRequiredOAuthScopes(granted: string[], required: string[]): boolean {
  const available = new Set(granted);
  return required.every((scope) => available.has(scope));
}

export function isSafeOAuthIssuer(value: string): boolean {
  try {
    requireSafeOAuthUrl(value, "issuer");
    return true;
  } catch {
    return false;
  }
}

async function requestToken(args: {
  metadata: McpOAuthMetadata;
  auth: McpOAuth2AuthConfig;
  form: Record<string, string>;
  clientSecret?: string;
  previousRefreshToken?: string;
  fallbackScopes?: string[];
  now?: number;
  fetch?: typeof fetch;
}): Promise<McpOAuthTokenSet> {
  const issuer = requireSafeOAuthUrl(args.metadata.issuer, "issuer");
  const tokenEndpoint = requireSameOriginOAuthEndpoint(args.metadata.tokenEndpoint, issuer);
  const form = new URLSearchParams({ ...args.form, client_id: args.auth.clientId });
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (args.clientSecret) {
    headers.set("Authorization", `Basic ${bytesToBase64(new TextEncoder().encode(`${args.auth.clientId}:${args.clientSecret}`))}`);
    form.delete("client_id");
  }
  const response = await safeOAuthFetch(
    new URL(tokenEndpoint),
    { method: "POST", headers, body: form.toString() },
    issuer.origin,
    args.fetch || fetch,
  );
  const payload = await readBoundedJson(response).catch(() => null);
  if (!response.ok) {
    const invalidGrant = isRecord(payload) && payload.error === "invalid_grant";
    throw new McpOAuthError(
      invalidGrant ? "mcp_oauth_invalid_grant" : "mcp_oauth_exchange_failed",
      invalidGrant ? "OAuth 授权已失效，请重新连接" : "OAuth 服务拒绝了授权请求",
      !invalidGrant && response.status >= 500,
    );
  }
  if (!isRecord(payload)) throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth token 响应无效");
  const accessToken = boundedToken(payload.access_token);
  const refreshToken = payload.refresh_token === undefined
    ? args.previousRefreshToken
    : boundedToken(payload.refresh_token);
  if (!accessToken || (payload.token_type !== undefined && String(payload.token_type).toLowerCase() !== "bearer")) {
    throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth token 响应无效");
  }
  const scopeText = typeof payload.scope === "string" ? payload.scope : "";
  const grantedScopes = normalizeOAuthScopes(scopeText ? scopeText.split(/\s+/) : args.fallbackScopes || args.auth.scopes);
  const expiresIn = typeof payload.expires_in === "number" && Number.isSafeInteger(payload.expires_in)
    && payload.expires_in > 0 && payload.expires_in <= 365 * 24 * 60 * 60
    ? payload.expires_in
    : undefined;
  return {
    accessToken,
    refreshToken: refreshToken || undefined,
    expiresAt: expiresIn ? (args.now || Date.now()) + expiresIn * 1_000 : undefined,
    grantedScopes,
    issuer: args.auth.issuer,
    clientId: args.auth.clientId,
    configRevision: args.auth.configRevision,
  };
}

async function safeOAuthFetch(
  url: URL,
  init: RequestInit,
  issuerOrigin: string,
  fetcher: typeof fetch,
): Promise<Response> {
  if (url.origin !== issuerOrigin || !isSafeOAuthUrl(url)) {
    throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth endpoint 不允许访问");
  }
  const response = await fetcher(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new McpOAuthError("mcp_oauth_metadata_unavailable", "OAuth endpoint 返回了不允许的重定向");
  }
  return response;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("Content-Length") || "0");
  if (declared > MAX_OAUTH_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth 响应超过大小限制");
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OAUTH_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth 响应超过大小限制");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth 响应不是有效 JSON");
  }
}

function oauthMetadataUrl(issuer: URL): URL {
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const url = new URL(issuer.origin);
  url.pathname = `/.well-known/oauth-authorization-server${path}`;
  return url;
}

function requireSameOriginOAuthEndpoint(value: unknown, issuer: URL): string {
  if (typeof value !== "string") {
    throw new McpOAuthError("mcp_oauth_metadata_unavailable", "OAuth 元数据缺少 endpoint");
  }
  const endpoint = requireSafeOAuthUrl(value, "endpoint");
  if (endpoint.origin !== issuer.origin || endpoint.search || endpoint.hash) {
    throw new McpOAuthError("mcp_oauth_metadata_unavailable", "OAuth endpoint 与 issuer 不匹配");
  }
  return endpoint.toString();
}

function requireSafeOAuthUrl(value: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpOAuthError("mcp_oauth_config_invalid", `OAuth ${field} 无效`);
  }
  if (!isSafeOAuthUrl(url)) throw new McpOAuthError("mcp_oauth_config_invalid", `OAuth ${field} 不允许访问`);
  return url;
}

function isSafeOAuthUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isPublicIpv4(hostname);
  if (hostname.includes(":")) return isPublicIpv6(hostname);
  return true;
}

function isPublicIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0) || a >= 224);
}

function isPublicIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return !(normalized === "::" || normalized === "::1"
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || normalized.startsWith("fe8") || normalized.startsWith("fe9")
    || normalized.startsWith("fea") || normalized.startsWith("feb")
    || normalized.startsWith("ff") || normalized.startsWith("2001:db8:"));
}

function normalizeTokenSet(value: unknown): McpOAuthTokenSet {
  if (!isRecord(value)) throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接记录无效，请重新连接");
  const accessToken = boundedToken(value.accessToken);
  const refreshToken = value.refreshToken === undefined ? undefined : boundedToken(value.refreshToken);
  const grantedScopes = normalizeOAuthScopes(value.grantedScopes);
  if (
    !accessToken
    || (value.refreshToken !== undefined && !refreshToken)
    || (value.expiresAt !== undefined && (!Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= 0))
    || typeof value.issuer !== "string"
    || typeof value.clientId !== "string"
    || typeof value.configRevision !== "string"
  ) {
    throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接记录无效，请重新连接");
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: value.expiresAt === undefined ? undefined : Number(value.expiresAt),
    grantedScopes,
    issuer: value.issuer,
    clientId: value.clientId,
    configRevision: value.configRevision,
  };
}

async function importMasterKey(value: string | undefined): Promise<CryptoKey> {
  try {
    const raw = base64ToBytes(value?.trim() || "");
    if (raw.byteLength !== 32) throw new Error("wrong key length");
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth token 主密钥不可用");
  }
}

function tokenAdditionalData(ownerLabel: string, serverId: string): Uint8Array {
  return new TextEncoder().encode(`chatus:mcp-oauth-token:v1:${ownerLabel}:${serverId}`);
}

function boundedToken(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_OAUTH_TOKEN_CHARS ? value : "";
}

function randomBase64Url(bytes: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function bytesToBase64Url(value: Uint8Array): string {
  return bytesToBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("invalid base64");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
