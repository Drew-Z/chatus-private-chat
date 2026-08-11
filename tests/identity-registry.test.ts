import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  conversationResourceInstanceName,
  principalRootInstanceName,
  principalUserStateInstanceName,
} from "../src/contracts/identity";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";

describe("IdentityRegistry", () => {
  it("pins existing legacy routes and replays the exact operation", async () => {
    const registry = identityRegistry();
    const input = {
      version: 1 as const,
      operationId: operationId("legacy"),
      alias: uniqueAlias("legacy"),
      origin: "legacy" as const,
      legacyRootInstance: "member-existing-root",
      legacyUserStateInstance: "existing-user-state",
    };
    const first = await registry.resolveOrCreatePrincipal(input);
    const replay = await registry.resolveOrCreatePrincipal(input);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      origin: "legacy",
      migrationState: "backfilled",
      rootInstanceName: input.legacyRootInstance,
      userStateInstanceName: input.legacyUserStateInstance,
      registryRevision: 1,
    });
    await expect(registry.resolvePrincipalSession({
      version: 1,
      principalId: first.principalId,
      alias: input.alias,
    })).resolves.toEqual(first);
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.resolveOrCreatePrincipal({ ...input, legacyRootInstance: "wrong-root" }))
        .rejects.toThrow("identity_operation_conflict");
    });
  });

  it("derives native principal and conversation routes only from opaque IDs", async () => {
    const registry = identityRegistry();
    const principal = await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("native"),
      alias: uniqueAlias("native"),
      origin: "native",
    });
    expect(principal.rootInstanceName).toBe(principalRootInstanceName(principal.principalId));
    expect(principal.userStateInstanceName).toBe(principalUserStateInstanceName(principal.principalId));

    const resourceInput = {
      version: 1 as const,
      operationId: operationId("resource"),
      principalId: principal.principalId,
      conversationId: "conversation-client-label",
    };
    const resource = await registry.ensureConversationResource(resourceInput);
    expect(resource.agentInstanceName).toBe(conversationResourceInstanceName(resource.resourceId));
    await expect(registry.resolveConversationResource({
      version: 1,
      principalId: principal.principalId,
      conversationId: resourceInput.conversationId,
    })).resolves.toEqual(resource);
    await expect(registry.ensureConversationResource(resourceInput)).resolves.toEqual(resource);

    await registry.recordStableIdentityMarker({
      version: 1,
      entityType: "resource",
      entityId: resource.resourceId,
      markerKind: "conversation",
      pinnedInstanceName: resource.agentInstanceName,
      expectedRegistryRevision: resource.registryRevision,
      expectedPrincipalRevision: principal.registryRevision,
      digest: "c".repeat(64),
      recordedAt: Date.now(),
    });
    await registry.advanceIdentityState({
      version: 1,
      operationId: operationId("resource-reconcile"),
      entityType: "resource",
      entityId: resource.resourceId,
      expectedRegistryRevision: resource.registryRevision,
      from: "backfilled",
      to: "reconciled",
    });
    await expect(registry.ensureConversationResource(resourceInput)).resolves.toMatchObject({
      resourceId: resource.resourceId,
      migrationState: "reconciled",
      registryRevision: 2,
    });
  });

  it("never reattaches a retired alias to its legacy-named stores", async () => {
    const registry = identityRegistry();
    const alias = uniqueAlias("reuse");
    const legacy = await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("reuse-legacy"),
      alias,
      origin: "legacy",
      legacyRootInstance: "member-retired-root",
      legacyUserStateInstance: alias,
    });
    await registry.retirePrincipalAlias({
      version: 1,
      operationId: operationId("reuse-retire"),
      principalId: legacy.principalId,
      alias,
      retiredAt: Date.now(),
    });
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.resolvePrincipalSession({
        version: 1,
        principalId: legacy.principalId,
        alias,
      })).rejects.toThrow("identity_session_conflict");
      await expect(instance.advanceIdentityState({
        version: 1,
        operationId: operationId("reuse-retired-transition"),
        entityType: "principal",
        entityId: legacy.principalId,
        expectedRegistryRevision: 2,
        from: "backfilled",
        to: "reconciled",
      })).rejects.toThrow("identity_principal_inactive");
    });

    const replacement = await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("reuse-replacement"),
      alias,
      origin: "legacy",
      legacyRootInstance: "member-retired-root",
      legacyUserStateInstance: alias,
    });
    expect(replacement.principalId).not.toBe(legacy.principalId);
    expect(replacement.origin).toBe("native");
    expect(replacement.rootInstanceName).toBe(principalRootInstanceName(replacement.principalId));
    expect(replacement.userStateInstanceName).toBe(principalUserStateInstanceName(replacement.principalId));
    expect(replacement.rootInstanceName).not.toBe(legacy.rootInstanceName);
    expect(replacement.userStateInstanceName).not.toBe(legacy.userStateInstanceName);
  });

  it("requires current exact markers for each one-step authority transition", async () => {
    const registry = identityRegistry();
    const principal = await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("transition"),
      alias: uniqueAlias("transition"),
      origin: "native",
    });
    const digest = "a".repeat(64);
    await registry.recordStableIdentityMarker({
      version: 1,
      entityType: "principal",
      entityId: principal.principalId,
      markerKind: "root",
      pinnedInstanceName: principal.rootInstanceName,
      expectedRegistryRevision: 1,
      expectedPrincipalRevision: 1,
      digest,
      recordedAt: Date.now(),
    });
    await registry.recordStableIdentityMarker({
      version: 1,
      entityType: "principal",
      entityId: principal.principalId,
      markerKind: "user_state",
      pinnedInstanceName: principal.userStateInstanceName,
      expectedRegistryRevision: 1,
      expectedPrincipalRevision: 1,
      digest,
      recordedAt: Date.now(),
    });
    const reconciled = await registry.advanceIdentityState({
      version: 1,
      operationId: operationId("transition-reconcile"),
      entityType: "principal",
      entityId: principal.principalId,
      expectedRegistryRevision: 1,
      from: "backfilled",
      to: "reconciled",
    });
    expect(reconciled).toMatchObject({ migrationState: "reconciled", registryRevision: 2 });
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.advanceIdentityState({
        version: 1,
        operationId: operationId("transition-authority-missing"),
        entityType: "principal",
        entityId: principal.principalId,
        expectedRegistryRevision: 2,
        from: "reconciled",
        to: "authoritative",
      })).rejects.toThrow("identity_marker_missing");
    });

    for (const [markerKind, pinnedInstanceName] of [
      ["root", principal.rootInstanceName],
      ["user_state", principal.userStateInstanceName],
    ] as const) {
      await registry.recordStableIdentityMarker({
        version: 1,
        entityType: "principal",
        entityId: principal.principalId,
        markerKind,
        pinnedInstanceName,
        expectedRegistryRevision: 2,
        expectedPrincipalRevision: 2,
        digest: "b".repeat(64),
        recordedAt: Date.now(),
      });
    }
    await expect(registry.advanceIdentityState({
      version: 1,
      operationId: operationId("transition-authority"),
      entityType: "principal",
      entityId: principal.principalId,
      expectedRegistryRevision: 2,
      from: "reconciled",
      to: "authoritative",
    })).resolves.toMatchObject({ migrationState: "authoritative", registryRevision: 3 });
  });

  it("records a fresh resource marker when only the owning principal revision advances", async () => {
    const registry = identityRegistry();
    const principal = await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("principal-resource-revision"),
      alias: uniqueAlias("principal-resource-revision"),
      origin: "native",
    });
    const resource = await registry.ensureConversationResource({
      version: 1,
      operationId: operationId("principal-resource-revision-resource"),
      principalId: principal.principalId,
      conversationId: "principal-resource-revision-conversation",
    });
    await registry.recordStableIdentityMarker({
      version: 1,
      entityType: "resource",
      entityId: resource.resourceId,
      markerKind: "conversation",
      pinnedInstanceName: resource.agentInstanceName,
      expectedRegistryRevision: resource.registryRevision,
      expectedPrincipalRevision: principal.registryRevision,
      digest: "a".repeat(64),
      recordedAt: Date.now(),
    });
    for (const [markerKind, pinnedInstanceName] of [
      ["root", principal.rootInstanceName],
      ["user_state", principal.userStateInstanceName],
    ] as const) {
      await registry.recordStableIdentityMarker({
        version: 1,
        entityType: "principal",
        entityId: principal.principalId,
        markerKind,
        pinnedInstanceName,
        expectedRegistryRevision: principal.registryRevision,
        expectedPrincipalRevision: principal.registryRevision,
        digest: "b".repeat(64),
        recordedAt: Date.now(),
      });
    }
    const advanced = await registry.advanceIdentityState({
      version: 1,
      operationId: operationId("principal-resource-revision-advance"),
      entityType: "principal",
      entityId: principal.principalId,
      expectedRegistryRevision: principal.registryRevision,
      from: "backfilled",
      to: "reconciled",
    });
    await expect(registry.recordStableIdentityMarker({
      version: 1,
      entityType: "resource",
      entityId: resource.resourceId,
      markerKind: "conversation",
      pinnedInstanceName: resource.agentInstanceName,
      expectedRegistryRevision: resource.registryRevision,
      expectedPrincipalRevision: advanced.registryRevision,
      digest: "c".repeat(64),
      recordedAt: Date.now(),
    })).resolves.toEqual({ created: true });
    await expect(registry.advanceIdentityState({
      version: 1,
      operationId: operationId("principal-resource-revision-resource-advance"),
      entityType: "resource",
      entityId: resource.resourceId,
      expectedRegistryRevision: resource.registryRevision,
      from: "backfilled",
      to: "reconciled",
    })).resolves.toMatchObject({ migrationState: "reconciled" });
  });

  it("returns bounded idempotent reconciliation evidence without exposing aliases or routes", async () => {
    const registry = identityRegistry();
    const principal = await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("reconcile-principal"),
      alias: uniqueAlias("reconcile"),
      origin: "native",
    });
    let resource = await registry.ensureConversationResource({
      version: 1,
      operationId: operationId("reconcile-resource"),
      principalId: principal.principalId,
      conversationId: "conversation-reconcile",
    });
    for (const to of ["reconciled", "authoritative"] as const) {
      await registry.recordStableIdentityMarker({
        version: 1,
        entityType: "resource",
        entityId: resource.resourceId,
        markerKind: "conversation",
        pinnedInstanceName: resource.agentInstanceName,
        expectedRegistryRevision: resource.registryRevision,
        expectedPrincipalRevision: principal.registryRevision,
        digest: "c".repeat(64),
        recordedAt: Date.now(),
      });
      await registry.advanceIdentityState({
        version: 1,
        operationId: operationId(`reconcile-resource-${to}`),
        entityType: "resource",
        entityId: resource.resourceId,
        expectedRegistryRevision: resource.registryRevision,
        from: resource.migrationState,
        to,
      });
      resource = await registry.resolveConversationResource({
        version: 1,
        principalId: principal.principalId,
        conversationId: resource.conversationId,
      });
    }
    await registry.recordStableIdentityMarker({
      version: 1,
      entityType: "resource",
      entityId: resource.resourceId,
      markerKind: "conversation",
      pinnedInstanceName: resource.agentInstanceName,
      expectedRegistryRevision: resource.registryRevision,
      expectedPrincipalRevision: principal.registryRevision,
      digest: "c".repeat(64),
      recordedAt: Date.now(),
    });
    const missingMarkers = await registry.reconcilePrincipalIdentity({
      version: 1,
      operationId: operationId("reconcile-missing-markers"),
      principalId: principal.principalId,
      expectedRegistryRevision: principal.registryRevision,
      conversations: [{
        conversationId: resource.conversationId,
        expectedAgentInstance: resource.agentInstanceName,
      }],
    });
    expect(missingMarkers).toMatchObject({
      authoritative: false,
      eligibleForAuthority: false,
      issues: [{ code: "principal_marker_missing", count: 2 }],
    });

    for (const [markerKind, pinnedInstanceName] of [
      ["root", principal.rootInstanceName],
      ["user_state", principal.userStateInstanceName],
    ] as const) {
      await registry.recordStableIdentityMarker({
        version: 1,
        entityType: "principal",
        entityId: principal.principalId,
        markerKind,
        pinnedInstanceName,
        expectedRegistryRevision: principal.registryRevision,
        expectedPrincipalRevision: principal.registryRevision,
        digest: "d".repeat(64),
        recordedAt: Date.now(),
      });
    }
    const input = {
      version: 1 as const,
      operationId: operationId("reconcile-exact"),
      principalId: principal.principalId,
      expectedRegistryRevision: principal.registryRevision,
      conversations: [{
        conversationId: resource.conversationId,
        expectedAgentInstance: resource.agentInstanceName,
      }],
    };
    const exact = await registry.reconcilePrincipalIdentity(input);
    expect(exact).toMatchObject({
      principalId: principal.principalId,
      registryRevision: principal.registryRevision,
      checkedConversations: 1,
      totalResources: 1,
      issues: [],
      eligibleForAuthority: true,
      authoritative: false,
    });
    expect(exact.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(exact)).not.toContain(principal.alias);
    expect(JSON.stringify(exact)).not.toContain(resource.agentInstanceName);
    await expect(registry.reconcilePrincipalIdentity(input)).resolves.toEqual(exact);
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.reconcilePrincipalIdentity({
        ...input,
        conversations: [{
          conversationId: resource.conversationId,
          expectedAgentInstance: "conversation-wrong-route",
        }],
      })).rejects.toThrow("identity_operation_conflict");
    });
  });

  it("captures and registers only bounded authoritative identity metadata", async () => {
    const registry = identityRegistry();
    const before = await registry.inspect();
    await registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: operationId("capture"),
      alias: uniqueAlias("capture"),
      origin: "native",
    });
    const after = await registry.inspect();
    expect(after.schemaVersion).toBe("identity-registry-v1");
    expect(after.principals.active).toBe(before.principals.active + 1);
    expect(after.aliases.active).toBe(before.aliases.active + 1);
    expect(after.resources).toBe(before.resources);
    expect(after.migration.backfilled).toBe(before.migration.backfilled + 1);
    await expect(registry.captureInstanceState("identity-registry-test"))
      .resolves.toMatchObject({ schemaVersion: "identity-registry-v1" });
    const objects = await env.INSTANCE_COORDINATOR
      .getByName("$instance-maintenance")
      .listRegisteredObjects();
    expect(objects).toMatchObject({ ok: true });
    if (objects.ok) {
      expect(objects.objects).toContainEqual(expect.objectContaining({
        kind: "identity_registry",
        instanceName: IDENTITY_REGISTRY_INSTANCE_NAME,
        schemaVersion: "identity-registry-v1",
        stateClass: "authoritative",
        restoreBehavior: "restore",
      }));
    }
    const columns = await runInDurableObject(registry, async (_instance, state) => (
      state.storage.sql.exec<{ name: string }>("PRAGMA table_info(identity_operations)")
        .toArray().map((row) => row.name)
    ));
    expect(columns).not.toEqual(expect.arrayContaining([
      "access_code", "credential", "token", "prompt", "content", "object_key",
    ]));
  });
});

function identityRegistry() {
  return env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
}

function operationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function uniqueAlias(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}
