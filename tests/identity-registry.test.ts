import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_ACCESS_ACTIONS,
  conversationAccessRoleAllowsAction,
  conversationResourceInstanceName,
  createConversationResourceId,
  createPrincipalId,
  decodeResolveConversationAccessInput,
  decodeUpsertConversationGrantInput,
  principalRootInstanceName,
  principalUserStateInstanceName,
} from "../src/contracts/identity";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";

describe("IdentityRegistry", () => {
  it("strictly decodes ACL v1 inputs and owns the complete role action matrix", () => {
    const actorPrincipalId = createPrincipalId();
    const targetPrincipalId = createPrincipalId();
    const resourceId = createConversationResourceId();
    const resolveInput = {
      version: 1,
      actorPrincipalId,
      resourceId,
      conversationId: "conversation-contract",
      action: "conversation.read",
      expectedAccessRevision: 1,
    };
    expect(decodeResolveConversationAccessInput(resolveInput)).toEqual(resolveInput);
    expect(decodeResolveConversationAccessInput({ ...resolveInput, role: "owner" })).toBeUndefined();
    expect(decodeResolveConversationAccessInput({ ...resolveInput, action: "conversation.unknown" })).toBeUndefined();

    const grantInput = {
      version: 1,
      operationId: operationId("strict-grant"),
      actorPrincipalId,
      resourceId,
      targetPrincipalId,
      role: "editor",
      expectedAccessRevision: 1,
    };
    expect(decodeUpsertConversationGrantInput(grantInput)).toEqual(grantInput);
    expect(decodeUpsertConversationGrantInput({ ...grantInput, expiresAt: Date.now() })).toBeUndefined();
    expect(decodeUpsertConversationGrantInput({ ...grantInput, role: "owner" })).toBeUndefined();

    for (const action of CONVERSATION_ACCESS_ACTIONS) {
      expect(conversationAccessRoleAllowsAction("owner", action)).toBe(true);
      expect(conversationAccessRoleAllowsAction("viewer", action)).toBe(
        action === "conversation.list" || action === "conversation.read",
      );
      expect(conversationAccessRoleAllowsAction("editor", action)).toBe(
        action === "conversation.list"
          || action === "conversation.read"
          || action === "conversation.message.send"
          || action === "conversation.message.stop"
          || action === "conversation.title.update",
      );
    }
  });

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

  it("synthesizes owner access and revision-gates grant, role change, revoke, and replay", async () => {
    const registry = identityRegistry();
    const owner = await createNativePrincipal(registry, "acl-owner");
    const editor = await createNativePrincipal(registry, "acl-editor");
    const outsider = await createNativePrincipal(registry, "acl-outsider");
    const resource = await registry.ensureConversationResource({
      version: 1,
      operationId: operationId("acl-resource"),
      principalId: owner.principalId,
      conversationId: "conversation-acl-lifecycle",
    });

    await expect(registry.lookupConversationResourceById({ version: 1, resourceId: resource.resourceId }))
      .resolves.toMatchObject({ found: true, route: resource });
    await expect(registry.resolveConversationAccess({
      version: 1,
      actorPrincipalId: owner.principalId,
      resourceId: resource.resourceId,
      conversationId: resource.conversationId,
      action: "conversation.acl.mutate",
    })).resolves.toMatchObject({ role: "owner", accessRevision: 1, grantRevision: 0 });

    const grantInput = {
      version: 1 as const,
      operationId: operationId("acl-grant"),
      actorPrincipalId: owner.principalId,
      resourceId: resource.resourceId,
      targetPrincipalId: editor.principalId,
      role: "editor" as const,
      expectedAccessRevision: 1,
    };
    const granted = await registry.upsertConversationGrant(grantInput);
    expect(granted).toMatchObject({ changed: true, accessRevision: 2 });
    expect(granted.grants).toEqual([expect.objectContaining({
      principalId: editor.principalId,
      alias: editor.alias,
      role: "editor",
      grantRevision: 2,
    })]);
    await expect(registry.upsertConversationGrant(grantInput)).resolves.toEqual(granted);
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.upsertConversationGrant({ ...grantInput, role: "viewer" }))
        .rejects.toThrow("conversation_acl_operation_conflict");
    });
    await expect(registry.resolveConversationAccess({
      version: 1,
      actorPrincipalId: editor.principalId,
      resourceId: resource.resourceId,
      conversationId: resource.conversationId,
      action: "conversation.message.send",
      expectedAccessRevision: 2,
    })).resolves.toMatchObject({ role: "editor", grantRevision: 2 });
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.resolveConversationAccess({
        version: 1,
        actorPrincipalId: editor.principalId,
        resourceId: resource.resourceId,
        conversationId: resource.conversationId,
        action: "conversation.settings.update",
      })).rejects.toThrow("conversation_action_denied");
      await expect(instance.resolveConversationAccess({
        version: 1,
        actorPrincipalId: outsider.principalId,
        resourceId: resource.resourceId,
        conversationId: resource.conversationId,
        action: "conversation.read",
      })).rejects.toThrow("conversation_not_found");
    });

    const sharedRoutes = await registry.listConversationAccessRoutes({
      version: 1,
      actorPrincipalId: editor.principalId,
      limit: 50,
    });
    expect(sharedRoutes.routes).toEqual([expect.objectContaining({
      resourceId: resource.resourceId,
      role: "editor",
      accessRevision: 2,
      grantRevision: 2,
    })]);
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.listConversationGrants({
        version: 1,
        actorPrincipalId: editor.principalId,
        resourceId: resource.resourceId,
      })).rejects.toThrow("conversation_action_denied");
    });

    const changedRole = await registry.upsertConversationGrant({
      ...grantInput,
      operationId: operationId("acl-role-change"),
      role: "viewer",
      expectedAccessRevision: 2,
    });
    expect(changedRole).toMatchObject({ changed: true, accessRevision: 3 });
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.upsertConversationGrant({
        ...grantInput,
        operationId: operationId("acl-stale"),
        expectedAccessRevision: 2,
      })).rejects.toThrow("conversation_access_revision_conflict");
      await expect(instance.resolveConversationAccess({
        version: 1,
        actorPrincipalId: editor.principalId,
        resourceId: resource.resourceId,
        conversationId: resource.conversationId,
        action: "conversation.message.send",
      })).rejects.toThrow("conversation_action_denied");
    });
    await expect(registry.assertConversationMutationCommit({
      version: 1,
      actorPrincipalId: editor.principalId,
      resourceId: resource.resourceId,
      conversationId: resource.conversationId,
      action: "conversation.read",
      accessRevision: 3,
      grantRevision: 3,
    })).resolves.toMatchObject({ role: "viewer" });

    const revokeInput = {
      version: 1 as const,
      operationId: operationId("acl-revoke"),
      actorPrincipalId: owner.principalId,
      resourceId: resource.resourceId,
      targetPrincipalId: editor.principalId,
      expectedAccessRevision: 3,
    };
    const revoked = await registry.revokeConversationGrant(revokeInput);
    expect(revoked).toMatchObject({ changed: true, accessRevision: 4, grants: [] });
    await expect(registry.revokeConversationGrant(revokeInput)).resolves.toEqual(revoked);
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.resolveConversationAccess({
        version: 1,
        actorPrincipalId: editor.principalId,
        resourceId: resource.resourceId,
        conversationId: resource.conversationId,
        action: "conversation.read",
      })).rejects.toThrow("conversation_not_found");
      await expect(instance.assertConversationMutationCommit({
        version: 1,
        actorPrincipalId: editor.principalId,
        resourceId: resource.resourceId,
        conversationId: resource.conversationId,
        action: "conversation.read",
        accessRevision: 3,
        grantRevision: 3,
      })).rejects.toThrow("conversation_not_found");
    });
    await expect(registry.revokeConversationGrant({
      ...revokeInput,
      operationId: operationId("acl-revoke-noop"),
      expectedAccessRevision: 4,
    })).resolves.toMatchObject({ changed: false, accessRevision: 4 });

    const audit = await runInDurableObject(registry, async (_instance, state) => ({
      entries: state.storage.sql.exec<{
        state: string;
        grant_revision: number;
        revoke_revision: number;
        revoked_by_principal_id: string;
      }>(
        "SELECT state, grant_revision, revoke_revision, revoked_by_principal_id FROM conversation_acl_entries WHERE resource_id = ?",
        resource.resourceId,
      ).toArray(),
      events: state.storage.sql.exec<{
        event_type: string;
        before_role: string | null;
        after_role: string | null;
        access_revision: number;
      }>(
        "SELECT event_type, before_role, after_role, access_revision FROM conversation_acl_events WHERE resource_id = ? ORDER BY access_revision",
        resource.resourceId,
      ).toArray(),
    }));
    expect(audit.entries).toEqual([expect.objectContaining({
      state: "revoked",
      grant_revision: 3,
      revoke_revision: 4,
      revoked_by_principal_id: owner.principalId,
    })]);
    expect(audit.events).toEqual([
      { event_type: "grant", before_role: null, after_role: "editor", access_revision: 2 },
      { event_type: "role_change", before_role: "editor", after_role: "viewer", access_revision: 3 },
      { event_type: "revoke", before_role: "viewer", after_role: null, access_revision: 4 },
    ]);
  });

  it("paginates access routes and revokes active grants when the grantee retires", async () => {
    const registry = identityRegistry();
    const owner = await createNativePrincipal(registry, "page-owner");
    const grantee = await createNativePrincipal(registry, "page-grantee");
    const resources = [];
    for (let index = 0; index < 3; index += 1) {
      const resource = await registry.ensureConversationResource({
        version: 1,
        operationId: operationId(`page-resource-${index}`),
        principalId: owner.principalId,
        conversationId: `conversation-page-${index}`,
      });
      resources.push(resource);
      await registry.upsertConversationGrant({
        version: 1,
        operationId: operationId(`page-grant-${index}`),
        actorPrincipalId: owner.principalId,
        resourceId: resource.resourceId,
        targetPrincipalId: grantee.principalId,
        role: "viewer",
        expectedAccessRevision: 1,
      });
    }
    const expectedIds = resources.map((resource) => resource.resourceId).sort();
    const first = await registry.listConversationAccessRoutes({
      version: 1,
      actorPrincipalId: grantee.principalId,
      limit: 2,
    });
    expect(first.routes.map((route) => route.resourceId)).toEqual(expectedIds.slice(0, 2));
    expect(first.nextCursor).toBe(expectedIds[1]);
    const second = await registry.listConversationAccessRoutes({
      version: 1,
      actorPrincipalId: grantee.principalId,
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.routes.map((route) => route.resourceId)).toEqual(expectedIds.slice(2));
    expect(second.nextCursor).toBeUndefined();

    await registry.retirePrincipalAlias({
      version: 1,
      operationId: operationId("page-retire"),
      principalId: grantee.principalId,
      alias: grantee.alias,
      retiredAt: Date.now(),
    });
    await runInDurableObject(registry, async (instance) => {
      await expect(instance.resolveConversationAccess({
        version: 1,
        actorPrincipalId: grantee.principalId,
        resourceId: resources[0].resourceId,
        conversationId: resources[0].conversationId,
        action: "conversation.read",
      })).rejects.toThrow("conversation_not_found");
    });
    const retiredProjection = await runInDurableObject(registry, async (_instance, state) => ({
      active: state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM conversation_acl_entries WHERE grantee_principal_id = ? AND state = 'active'",
        grantee.principalId,
      ).one().count,
      revoked: state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM conversation_acl_entries WHERE grantee_principal_id = ? AND state = 'revoked'",
        grantee.principalId,
      ).one().count,
      events: state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM conversation_acl_events WHERE target_principal_id = ? AND event_type = 'revoke'",
        grantee.principalId,
      ).one().count,
      revokers: state.storage.sql.exec<{
        actor_principal_id: string | null;
        revoked_by_principal_id: string | null;
      }>(
        `SELECT events.actor_principal_id, entries.revoked_by_principal_id
         FROM conversation_acl_events events
         JOIN conversation_acl_entries entries
           ON entries.resource_id = events.resource_id
          AND entries.grantee_principal_id = events.target_principal_id
         WHERE events.target_principal_id = ? AND events.event_type = 'revoke'
         ORDER BY events.resource_id`,
        grantee.principalId,
      ).toArray(),
    }));
    expect(retiredProjection).toEqual({
      active: 0,
      revoked: 3,
      events: 3,
      revokers: Array.from({ length: 3 }, () => ({
        actor_principal_id: null,
        revoked_by_principal_id: null,
      })),
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
    expect(after.schemaVersion).toBe("identity-registry-v2");
    expect(after.principals.active).toBe(before.principals.active + 1);
    expect(after.aliases.active).toBe(before.aliases.active + 1);
    expect(after.resources).toBe(before.resources);
    expect(after.migration.backfilled).toBe(before.migration.backfilled + 1);
    const capture = await registry.captureInstanceState("identity-registry-test");
    expect(capture).toMatchObject({ schemaVersion: "identity-registry-v2" });
    const snapshot = JSON.parse(new TextDecoder().decode(capture.bytes)) as {
      tables: Array<{ name: string }>;
    };
    expect(snapshot.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      "conversation_acl_entries",
      "conversation_acl_events",
    ]));
    const objects = await env.INSTANCE_COORDINATOR
      .getByName("$instance-maintenance")
      .listRegisteredObjects();
    expect(objects).toMatchObject({ ok: true });
    if (objects.ok) {
      expect(objects.objects).toContainEqual(expect.objectContaining({
        kind: "identity_registry",
        instanceName: IDENTITY_REGISTRY_INSTANCE_NAME,
        schemaVersion: "identity-registry-v2",
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

async function createNativePrincipal(
  registry: ReturnType<typeof identityRegistry>,
  prefix: string,
) {
  return registry.resolveOrCreatePrincipal({
    version: 1,
    operationId: operationId(prefix),
    alias: uniqueAlias(prefix),
    origin: "native",
  });
}
