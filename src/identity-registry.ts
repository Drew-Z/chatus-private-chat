import { DurableObject } from "cloudflare:workers";
import {
  IDENTITY_REGISTRY_SCHEMA_VERSION,
  conversationResourceInstanceName,
  createConversationResourceId,
  createPrincipalId,
  decodeAdvanceIdentityStateInput,
  decodeAssertConversationMutationCommitInput,
  decodeEnsureConversationResourceInput,
  decodeListConversationAccessRoutesInput,
  decodeListConversationGrantsInput,
  decodeLookupConversationResourceByIdInput,
  decodeRecordStableIdentityMarkerInput,
  decodeReconcilePrincipalIdentityInput,
  decodeResolveConversationAccessInput,
  decodeResolveActivePrincipalAliasInput,
  decodeResolveConversationResourceInput,
  decodeResolveOrCreatePrincipalInput,
  decodeResolvePrincipalSessionInput,
  decodeRevokeConversationGrantInput,
  decodeRetirePrincipalAliasInput,
  decodeUpsertConversationGrantInput,
  conversationAccessRoleAllowsAction,
  principalRootInstanceName,
  principalUserStateInstanceName,
  type ConversationAccessActionV1,
  type ConversationAccessRoleV1,
  type ConversationAccessRouteListV1,
  type ConversationAccessSnapshotV1,
  type ConversationGrantListV1,
  type ConversationGrantMutationResultV1,
  type ConversationGrantRoleV1,
  type ConversationGrantStateV1,
  type ConversationGrantV1,
  type ConversationResourceRouteV1,
  type IdentityLifecycleState,
  type IdentityMigrationState,
  type IdentityOrigin,
  type IdentityReconciliationIssueV1,
  type IdentityReconciliationResultV1,
  type PrincipalRouteV1,
} from "./contracts/identity";
import type { InstanceCoordinator } from "./instance-coordinator";
import { captureDurableObjectState } from "./services/durable-object-capture";
import { INSTANCE_MAINTENANCE_COORDINATOR, stableJson } from "./services/instance-capture";

export const IDENTITY_REGISTRY_INSTANCE_NAME = "$identity-registry";

const IDENTITY_REGISTRY_TABLES = new Set([
  "identity_schema_migrations",
  "principals",
  "principal_aliases",
  "conversation_resources",
  "conversation_acl_entries",
  "conversation_acl_events",
  "identity_migration_markers",
  "identity_operations",
]);

type IdentityRegistryEnv = {
  INSTANCE_COORDINATOR: DurableObjectNamespace<InstanceCoordinator>;
};

type PrincipalRow = {
  principal_id: string;
  origin: IdentityOrigin;
  lifecycle_state: IdentityLifecycleState;
  migration_state: IdentityMigrationState;
  root_instance_name: string;
  user_state_instance_name: string;
  revision: number;
  created_at: number;
  updated_at: number;
};

type PrincipalAliasRow = {
  binding_id: string;
  alias: string;
  principal_id: string;
  state: IdentityLifecycleState;
  created_at: number;
  retired_at: number;
  revision: number;
};

type PrincipalRouteRow = PrincipalRow & Pick<PrincipalAliasRow, "alias">;

type ConversationResourceRow = {
  resource_id: string;
  principal_id: string;
  conversation_id: string;
  agent_instance_name: string;
  migration_state: IdentityMigrationState;
  revision: number;
  access_revision: number;
  created_at: number;
  updated_at: number;
};

type ConversationAclEntryRow = {
  resource_id: string;
  grantee_principal_id: string;
  role: ConversationGrantRoleV1;
  state: ConversationGrantStateV1;
  grant_revision: number;
  revoke_revision: number | null;
  granted_by_principal_id: string;
  revoked_by_principal_id: string | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
};

type ConversationGrantRow = ConversationAclEntryRow & { alias: string };

type ConversationAccessRouteRow = ConversationResourceRow & {
  role: ConversationAccessRoleV1;
  grant_revision: number;
  owner_root_instance_name: string;
};

type IdentityOperationRow = {
  operation_kind: string;
  fingerprint: string;
  result_json: string;
};

export type IdentityStateAdvanceResultV1 = {
  version: 1;
  entityType: "principal" | "resource";
  entityId: string;
  migrationState: IdentityMigrationState;
  registryRevision: number;
};

export type IdentityRegistryInspectionV1 = {
  version: 1;
  schemaVersion: `identity-registry-v${number}`;
  principals: { active: number; retired: number };
  aliases: { active: number; retired: number };
  resources: number;
  acl: { active: number; revoked: number; events: number };
  migration: Record<IdentityMigrationState, number>;
};

export type PrincipalAliasLookupResultV1 =
  | { version: 1; found: true; route: PrincipalRouteV1 }
  | { version: 1; found: false };

export type ConversationResourceLookupResultV1 =
  | { version: 1; found: true; route: ConversationResourceRouteV1 }
  | { version: 1; found: false };

export class IdentityRegistry extends DurableObject<IdentityRegistryEnv> {
  constructor(ctx: DurableObjectState, env: IdentityRegistryEnv) {
    super(ctx, env);
    if (ctx.id.name !== IDENTITY_REGISTRY_INSTANCE_NAME) {
      throw new Error("identity_registry_instance_name_invalid");
    }
    ctx.blockConcurrencyWhile(async () => {
      this.applySchemaMigrations();
    });
  }

  async resolveOrCreatePrincipal(input: unknown): Promise<PrincipalRouteV1> {
    const normalized = decodeResolveOrCreatePrincipalInput(input);
    if (!normalized) throw new Error("identity_principal_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("principal.resolve-or-create", normalized);
    const generatedPrincipalId = createPrincipalId();
    const generatedBindingId = `alias_${crypto.randomUUID()}`;
    const now = Date.now();

    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<PrincipalRouteV1>(
        normalized.operationId,
        "principal.resolve-or-create",
        fingerprint,
      );
      if (replay) {
        const current = this.readPrincipalByAlias(replay.principalId, normalized.alias);
        if (!current) throw new Error("identity_operation_target_missing");
        return principalRouteFromRow(current);
      }

      const active = this.readPrincipalByActiveAlias(normalized.alias);
      if (active) {
        if (
          active.origin === "legacy"
          && normalized.origin === "legacy"
          && (active.root_instance_name !== normalized.legacyRootInstance
            || active.user_state_instance_name !== normalized.legacyUserStateInstance)
        ) throw new Error("identity_principal_route_conflict");
        const result = principalRouteFromRow(active);
        this.writeOperation(normalized.operationId, "principal.resolve-or-create", fingerprint, result, now);
        return result;
      }

      const historicalAliases = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM principal_aliases WHERE alias = ?",
        normalized.alias,
      ).one().count;
      const origin: IdentityOrigin = historicalAliases > 0 ? "native" : normalized.origin;
      const rootInstanceName = origin === "legacy"
        ? normalized.legacyRootInstance!
        : principalRootInstanceName(generatedPrincipalId);
      const userStateInstanceName = origin === "legacy"
        ? normalized.legacyUserStateInstance!
        : principalUserStateInstanceName(generatedPrincipalId);

      this.ctx.storage.sql.exec(
        `INSERT INTO principals(
          principal_id, origin, lifecycle_state, migration_state, root_instance_name,
          user_state_instance_name, revision, created_at, updated_at
        ) VALUES (?, ?, 'active', 'backfilled', ?, ?, 1, ?, ?)`,
        generatedPrincipalId,
        origin,
        rootInstanceName,
        userStateInstanceName,
        now,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO principal_aliases(
          binding_id, alias, principal_id, state, created_at, retired_at, revision
        ) VALUES (?, ?, ?, 'active', ?, 0, 1)`,
        generatedBindingId,
        normalized.alias,
        generatedPrincipalId,
        now,
      );
      const result = principalRouteFromRow({
        principal_id: generatedPrincipalId,
        alias: normalized.alias,
        origin,
        lifecycle_state: "active",
        migration_state: "backfilled",
        root_instance_name: rootInstanceName,
        user_state_instance_name: userStateInstanceName,
        revision: 1,
        created_at: now,
        updated_at: now,
      });
      this.writeOperation(normalized.operationId, "principal.resolve-or-create", fingerprint, result, now);
      return result;
    });
  }

  async resolvePrincipalSession(input: unknown): Promise<PrincipalRouteV1> {
    const normalized = decodeResolvePrincipalSessionInput(input);
    if (!normalized) throw new Error("identity_session_input_invalid");
    await this.registerObject();
    const row = this.ctx.storage.sql.exec<PrincipalRouteRow>(
      `SELECT p.*, a.alias
       FROM principals p JOIN principal_aliases a ON a.principal_id = p.principal_id
       WHERE p.principal_id = ? AND p.lifecycle_state = 'active'
         AND a.alias = ? AND a.state = 'active'`,
      normalized.principalId,
      normalized.alias,
    ).toArray()[0];
    if (!row) throw new Error("identity_session_conflict");
    return principalRouteFromRow(row);
  }

  async resolveActivePrincipalAlias(input: unknown): Promise<PrincipalRouteV1> {
    const normalized = decodeResolveActivePrincipalAliasInput(input);
    if (!normalized) throw new Error("identity_alias_resolve_input_invalid");
    await this.registerObject();
    const row = this.readPrincipalByActiveAlias(normalized.alias);
    if (!row) throw new Error("identity_alias_missing");
    return principalRouteFromRow(row);
  }

  async lookupActivePrincipalAlias(input: unknown): Promise<PrincipalAliasLookupResultV1> {
    const normalized = decodeResolveActivePrincipalAliasInput(input);
    if (!normalized) throw new Error("identity_alias_resolve_input_invalid");
    await this.registerObject();
    const row = this.readPrincipalByActiveAlias(normalized.alias);
    return row
      ? { version: 1, found: true, route: principalRouteFromRow(row) }
      : { version: 1, found: false };
  }

  async lookupPrincipalAlias(input: unknown): Promise<PrincipalAliasLookupResultV1> {
    const normalized = decodeResolveActivePrincipalAliasInput(input);
    if (!normalized) throw new Error("identity_alias_resolve_input_invalid");
    await this.registerObject();
    const row = this.ctx.storage.sql.exec<PrincipalRouteRow>(
      `SELECT p.*, a.alias
       FROM principals p JOIN principal_aliases a ON a.principal_id = p.principal_id
       WHERE a.alias = ?
       ORDER BY a.created_at DESC, a.binding_id DESC LIMIT 1`,
      normalized.alias,
    ).toArray()[0];
    return row
      ? { version: 1, found: true, route: principalRouteFromRow(row) }
      : { version: 1, found: false };
  }

  async retirePrincipalAlias(input: unknown): Promise<{
    version: 1;
    principalId: string;
    alias: string;
    retired: boolean;
    registryRevision: number;
  }> {
    const normalized = decodeRetirePrincipalAliasInput(input);
    if (!normalized) throw new Error("identity_alias_retire_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("principal.alias-retire", normalized);

    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<{
        version: 1;
        principalId: string;
        alias: string;
        retired: boolean;
        registryRevision: number;
      }>(normalized.operationId, "principal.alias-retire", fingerprint);
      if (replay) return replay;
      const active = this.ctx.storage.sql.exec<PrincipalAliasRow>(
        "SELECT * FROM principal_aliases WHERE alias = ? AND state = 'active'",
        normalized.alias,
      ).toArray()[0];
      if (!active || active.principal_id !== normalized.principalId) {
        throw new Error("identity_alias_conflict");
      }
      this.ctx.storage.sql.exec(
        "UPDATE principal_aliases SET state = 'retired', retired_at = ?, revision = revision + 1 WHERE binding_id = ?",
        normalized.retiredAt,
        active.binding_id,
      );
      const remaining = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM principal_aliases WHERE principal_id = ? AND state = 'active'",
        normalized.principalId,
      ).one().count;
      this.ctx.storage.sql.exec(
        `UPDATE principals SET lifecycle_state = ?, revision = revision + 1, updated_at = ?
         WHERE principal_id = ?`,
        remaining > 0 ? "active" : "retired",
        normalized.retiredAt,
        normalized.principalId,
      );
      if (remaining === 0) {
        this.revokeActiveGrantsForRetiredPrincipal(normalized.principalId, normalized.retiredAt);
      }
      const revision = this.readPrincipal(normalized.principalId)?.revision;
      if (!revision) throw new Error("identity_principal_missing");
      const result = {
        version: 1 as const,
        principalId: normalized.principalId,
        alias: normalized.alias,
        retired: true,
        registryRevision: revision,
      };
      this.writeOperation(
        normalized.operationId,
        "principal.alias-retire",
        fingerprint,
        result,
        normalized.retiredAt,
      );
      return result;
    });
  }

  async ensureConversationResource(input: unknown): Promise<ConversationResourceRouteV1> {
    const normalized = decodeEnsureConversationResourceInput(input);
    if (!normalized) throw new Error("identity_resource_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("resource.ensure", normalized);
    const generatedResourceId = createConversationResourceId();
    const now = Date.now();

    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<ConversationResourceRouteV1>(
        normalized.operationId,
        "resource.ensure",
        fingerprint,
      );
      if (replay) {
        const current = this.readResourceById(replay.resourceId);
        if (
          !current || current.principal_id !== normalized.principalId
          || current.conversation_id !== normalized.conversationId
        ) throw new Error("identity_operation_target_missing");
        return conversationRouteFromRow(current);
      }
      const principal = this.readPrincipal(normalized.principalId);
      if (!principal || principal.lifecycle_state !== "active") throw new Error("identity_principal_inactive");
      const existing = this.readConversationResource(normalized.principalId, normalized.conversationId);
      if (existing) {
        if (normalized.legacyAgentInstance && existing.agent_instance_name !== normalized.legacyAgentInstance) {
          throw new Error("identity_resource_route_conflict");
        }
        const result = conversationRouteFromRow(existing);
        this.writeOperation(normalized.operationId, "resource.ensure", fingerprint, result, now);
        return result;
      }
      const agentInstanceName = normalized.legacyAgentInstance
        ?? conversationResourceInstanceName(generatedResourceId);
      this.ctx.storage.sql.exec(
        `INSERT INTO conversation_resources(
          resource_id, principal_id, conversation_id, agent_instance_name,
          migration_state, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'backfilled', 1, ?, ?)`,
        generatedResourceId,
        normalized.principalId,
        normalized.conversationId,
        agentInstanceName,
        now,
        now,
      );
      const result: ConversationResourceRouteV1 = {
        version: 1,
        resourceId: generatedResourceId,
        principalId: normalized.principalId,
        conversationId: normalized.conversationId,
        migrationState: "backfilled",
        agentInstanceName,
        registryRevision: 1,
      };
      this.writeOperation(normalized.operationId, "resource.ensure", fingerprint, result, now);
      return result;
    });
  }

  async resolveConversationResource(input: unknown): Promise<ConversationResourceRouteV1> {
    const normalized = decodeResolveConversationResourceInput(input);
    if (!normalized) throw new Error("identity_resource_resolve_input_invalid");
    await this.registerObject();
    const principal = this.readPrincipal(normalized.principalId);
    if (!principal || principal.lifecycle_state !== "active") throw new Error("identity_principal_inactive");
    const resource = this.readConversationResource(normalized.principalId, normalized.conversationId);
    if (!resource) throw new Error("identity_resource_missing");
    return conversationRouteFromRow(resource);
  }

  async lookupConversationResource(input: unknown): Promise<ConversationResourceLookupResultV1> {
    const normalized = decodeResolveConversationResourceInput(input);
    if (!normalized) throw new Error("identity_resource_resolve_input_invalid");
    await this.registerObject();
    const principal = this.readPrincipal(normalized.principalId);
    if (!principal || principal.lifecycle_state !== "active") {
      throw new Error("identity_principal_inactive");
    }
    const resource = this.readConversationResource(normalized.principalId, normalized.conversationId);
    return resource
      ? { version: 1, found: true, route: conversationRouteFromRow(resource) }
      : { version: 1, found: false };
  }

  async lookupConversationResourceById(input: unknown): Promise<ConversationResourceLookupResultV1> {
    const normalized = decodeLookupConversationResourceByIdInput(input);
    if (!normalized) throw new Error("identity_resource_lookup_input_invalid");
    await this.registerObject();
    const resource = this.readResourceById(normalized.resourceId);
    return resource
      ? { version: 1, found: true, route: conversationRouteFromRow(resource) }
      : { version: 1, found: false };
  }

  async resolveConversationAccess(input: unknown): Promise<ConversationAccessSnapshotV1> {
    const normalized = decodeResolveConversationAccessInput(input);
    if (!normalized) throw new Error("conversation_access_input_invalid");
    await this.registerObject();
    return this.resolveAccessSnapshot(
      normalized.actorPrincipalId,
      normalized.resourceId,
      normalized.conversationId,
      normalized.action,
      normalized.expectedAccessRevision,
    );
  }

  async listConversationAccessRoutes(input: unknown): Promise<ConversationAccessRouteListV1> {
    const normalized = decodeListConversationAccessRoutesInput(input);
    if (!normalized) throw new Error("conversation_access_list_input_invalid");
    await this.registerObject();
    const actor = this.readPrincipal(normalized.actorPrincipalId);
    if (!actor || actor.lifecycle_state !== "active") throw new Error("conversation_not_found");
    const rows = this.ctx.storage.sql.exec<ConversationAccessRouteRow>(
      `SELECT r.*, owner.root_instance_name AS owner_root_instance_name,
         CASE WHEN r.principal_id = ? THEN 'owner' ELSE a.role END AS role,
         CASE WHEN r.principal_id = ? THEN 0 ELSE a.grant_revision END AS grant_revision
       FROM conversation_resources r
       JOIN principals owner ON owner.principal_id = r.principal_id AND owner.lifecycle_state = 'active'
       LEFT JOIN conversation_acl_entries a
         ON a.resource_id = r.resource_id
        AND a.grantee_principal_id = ?
        AND a.state = 'active'
       WHERE r.resource_id > ?
         AND (r.principal_id = ? OR a.grantee_principal_id IS NOT NULL)
       ORDER BY r.resource_id ASC
       LIMIT ?`,
      normalized.actorPrincipalId,
      normalized.actorPrincipalId,
      normalized.actorPrincipalId,
      normalized.cursor ?? "",
      normalized.actorPrincipalId,
      normalized.limit + 1,
    ).toArray();
    const hasMore = rows.length > normalized.limit;
    const page = hasMore ? rows.slice(0, normalized.limit) : rows;
    const routes = page.map(conversationAccessRouteFromRow);
    return {
      version: 1,
      routes,
      ...(hasMore && routes.length > 0 ? { nextCursor: routes[routes.length - 1].resourceId } : {}),
    };
  }

  async listConversationGrants(input: unknown): Promise<ConversationGrantListV1> {
    const normalized = decodeListConversationGrantsInput(input);
    if (!normalized) throw new Error("conversation_acl_list_input_invalid");
    await this.registerObject();
    const resource = this.readResourceById(normalized.resourceId);
    if (!resource) throw new Error("conversation_not_found");
    this.resolveAccessSnapshot(
      normalized.actorPrincipalId,
      resource.resource_id,
      resource.conversation_id,
      "conversation.acl.read",
    );
    return this.readGrantList(resource);
  }

  async upsertConversationGrant(input: unknown): Promise<ConversationGrantMutationResultV1> {
    const normalized = decodeUpsertConversationGrantInput(input);
    if (!normalized) throw new Error("conversation_acl_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("conversation.acl-upsert", normalized);
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<ConversationGrantMutationResultV1>(
        normalized.operationId,
        "conversation.acl-upsert",
        fingerprint,
        "conversation_acl_operation_conflict",
      );
      if (replay) return replay;
      const resource = this.requireAclMutationAuthority(
        normalized.actorPrincipalId,
        normalized.resourceId,
        normalized.expectedAccessRevision,
      );
      if (normalized.targetPrincipalId === resource.principal_id) {
        throw new Error("conversation_acl_target_invalid");
      }
      const target = this.readPrincipal(normalized.targetPrincipalId);
      if (!target || target.lifecycle_state !== "active") {
        throw new Error("conversation_acl_target_unavailable");
      }
      const existing = this.readAclEntry(resource.resource_id, normalized.targetPrincipalId);
      if (existing?.state === "active" && existing.role === normalized.role) {
        const unchanged: ConversationGrantMutationResultV1 = {
          ...this.readGrantList(resource),
          operationId: normalized.operationId,
          changed: false,
        };
        this.writeOperation(
          normalized.operationId,
          "conversation.acl-upsert",
          fingerprint,
          unchanged,
          now,
        );
        return unchanged;
      }
      const accessRevision = resource.access_revision + 1;
      this.ctx.storage.sql.exec(
        "UPDATE conversation_resources SET access_revision = ?, updated_at = ? WHERE resource_id = ?",
        accessRevision,
        now,
        resource.resource_id,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO conversation_acl_entries(
          resource_id, grantee_principal_id, role, state, grant_revision, revoke_revision,
          granted_by_principal_id, revoked_by_principal_id, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, 'active', ?, NULL, ?, NULL, ?, ?, NULL)
        ON CONFLICT(resource_id, grantee_principal_id) DO UPDATE SET
          role = excluded.role,
          state = 'active',
          grant_revision = excluded.grant_revision,
          revoke_revision = NULL,
          granted_by_principal_id = excluded.granted_by_principal_id,
          revoked_by_principal_id = NULL,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          revoked_at = NULL`,
        resource.resource_id,
        normalized.targetPrincipalId,
        normalized.role,
        accessRevision,
        normalized.actorPrincipalId,
        now,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO conversation_acl_events(
          operation_id, resource_id, actor_principal_id, target_principal_id, event_type,
          before_role, after_role, access_revision, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.operationId,
        resource.resource_id,
        normalized.actorPrincipalId,
        normalized.targetPrincipalId,
        existing?.state === "active" ? "role_change" : "grant",
        existing?.state === "active" ? existing.role : null,
        normalized.role,
        accessRevision,
        now,
      );
      const updatedResource = { ...resource, access_revision: accessRevision, updated_at: now };
      const result: ConversationGrantMutationResultV1 = {
        ...this.readGrantList(updatedResource),
        operationId: normalized.operationId,
        changed: true,
      };
      this.writeOperation(
        normalized.operationId,
        "conversation.acl-upsert",
        fingerprint,
        result,
        now,
      );
      return result;
    });
  }

  async revokeConversationGrant(input: unknown): Promise<ConversationGrantMutationResultV1> {
    const normalized = decodeRevokeConversationGrantInput(input);
    if (!normalized) throw new Error("conversation_acl_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("conversation.acl-revoke", normalized);
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<ConversationGrantMutationResultV1>(
        normalized.operationId,
        "conversation.acl-revoke",
        fingerprint,
        "conversation_acl_operation_conflict",
      );
      if (replay) return replay;
      const resource = this.requireAclMutationAuthority(
        normalized.actorPrincipalId,
        normalized.resourceId,
        normalized.expectedAccessRevision,
      );
      if (normalized.targetPrincipalId === resource.principal_id) {
        throw new Error("conversation_acl_target_invalid");
      }
      const existing = this.readAclEntry(resource.resource_id, normalized.targetPrincipalId);
      if (!existing || existing.state !== "active") {
        const unchanged: ConversationGrantMutationResultV1 = {
          ...this.readGrantList(resource),
          operationId: normalized.operationId,
          changed: false,
        };
        this.writeOperation(
          normalized.operationId,
          "conversation.acl-revoke",
          fingerprint,
          unchanged,
          now,
        );
        return unchanged;
      }
      const accessRevision = resource.access_revision + 1;
      this.ctx.storage.sql.exec(
        "UPDATE conversation_resources SET access_revision = ?, updated_at = ? WHERE resource_id = ?",
        accessRevision,
        now,
        resource.resource_id,
      );
      this.ctx.storage.sql.exec(
        `UPDATE conversation_acl_entries
         SET state = 'revoked', revoke_revision = ?, revoked_by_principal_id = ?,
             updated_at = ?, revoked_at = ?
         WHERE resource_id = ? AND grantee_principal_id = ?`,
        accessRevision,
        normalized.actorPrincipalId,
        now,
        now,
        resource.resource_id,
        normalized.targetPrincipalId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO conversation_acl_events(
          operation_id, resource_id, actor_principal_id, target_principal_id, event_type,
          before_role, after_role, access_revision, occurred_at
        ) VALUES (?, ?, ?, ?, 'revoke', ?, NULL, ?, ?)`,
        normalized.operationId,
        resource.resource_id,
        normalized.actorPrincipalId,
        normalized.targetPrincipalId,
        existing.role,
        accessRevision,
        now,
      );
      const updatedResource = { ...resource, access_revision: accessRevision, updated_at: now };
      const result: ConversationGrantMutationResultV1 = {
        ...this.readGrantList(updatedResource),
        operationId: normalized.operationId,
        changed: true,
      };
      this.writeOperation(
        normalized.operationId,
        "conversation.acl-revoke",
        fingerprint,
        result,
        now,
      );
      return result;
    });
  }

  async assertConversationMutationCommit(input: unknown): Promise<ConversationAccessSnapshotV1> {
    const normalized = decodeAssertConversationMutationCommitInput(input);
    if (!normalized) throw new Error("conversation_access_commit_input_invalid");
    await this.registerObject();
    const snapshot = this.resolveAccessSnapshot(
      normalized.actorPrincipalId,
      normalized.resourceId,
      normalized.conversationId,
      normalized.action,
      normalized.accessRevision,
    );
    if (snapshot.grantRevision !== normalized.grantRevision) {
      throw new Error("conversation_access_revision_conflict");
    }
    return snapshot;
  }

  async recordStableIdentityMarker(input: unknown): Promise<{ created: boolean }> {
    const normalized = decodeRecordStableIdentityMarkerInput(input);
    if (!normalized) throw new Error("identity_marker_input_invalid");
    await this.registerObject();
    return this.ctx.storage.transactionSync(() => {
      const entity = normalized.entityType === "principal"
        ? this.readPrincipal(normalized.entityId)
        : this.readResourceById(normalized.entityId);
      if (!entity || entity.revision !== normalized.expectedRegistryRevision) {
        throw new Error("identity_registry_revision_conflict");
      }
      const expectedInstance = normalized.entityType === "resource"
        ? (entity as ConversationResourceRow).agent_instance_name
        : normalized.markerKind === "root"
          ? (entity as PrincipalRow).root_instance_name
          : (entity as PrincipalRow).user_state_instance_name;
      if (expectedInstance !== normalized.pinnedInstanceName) throw new Error("identity_marker_route_conflict");
      const principalRevision = normalized.entityType === "principal"
        ? entity.revision
        : this.readPrincipal((entity as ConversationResourceRow).principal_id)?.revision;
      if (principalRevision !== normalized.expectedPrincipalRevision) {
        throw new Error("identity_registry_revision_conflict");
      }
      const existing = this.ctx.storage.sql.exec<{
        pinned_instance_name: string;
        registry_revision: number;
        principal_revision: number;
        digest: string;
      }>(
        `SELECT pinned_instance_name, registry_revision, principal_revision, digest
         FROM identity_migration_markers
         WHERE entity_type = ? AND entity_id = ? AND marker_kind = ?
           AND registry_revision = ? AND principal_revision = ?`,
        normalized.entityType,
        normalized.entityId,
        normalized.markerKind,
        normalized.expectedRegistryRevision,
        normalized.expectedPrincipalRevision,
      ).toArray()[0];
      if (existing) {
        if (
          existing.pinned_instance_name !== normalized.pinnedInstanceName
          || existing.registry_revision !== normalized.expectedRegistryRevision
          || existing.principal_revision !== normalized.expectedPrincipalRevision
          || existing.digest !== normalized.digest
        ) throw new Error("identity_marker_conflict");
        return { created: false };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO identity_migration_markers(
          entity_type, entity_id, marker_kind, pinned_instance_name,
          registry_revision, principal_revision, digest, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.entityType,
        normalized.entityId,
        normalized.markerKind,
        normalized.pinnedInstanceName,
        normalized.expectedRegistryRevision,
        normalized.expectedPrincipalRevision,
        normalized.digest,
        normalized.recordedAt,
      );
      return { created: true };
    });
  }

  async advanceIdentityState(input: unknown): Promise<IdentityStateAdvanceResultV1> {
    const normalized = decodeAdvanceIdentityStateInput(input);
    if (!normalized) throw new Error("identity_state_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("identity.state-advance", normalized);
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<IdentityStateAdvanceResultV1>(
        normalized.operationId,
        "identity.state-advance",
        fingerprint,
      );
      if (replay) return replay;
      const entity = normalized.entityType === "principal"
        ? this.readPrincipal(normalized.entityId)
        : this.readResourceById(normalized.entityId);
      if (!entity) throw new Error("identity_entity_missing");
      const owningPrincipal = normalized.entityType === "principal"
        ? entity as PrincipalRow
        : this.readPrincipal((entity as ConversationResourceRow).principal_id);
      if (!owningPrincipal || owningPrincipal.lifecycle_state !== "active") {
        throw new Error("identity_principal_inactive");
      }
      if (entity.revision !== normalized.expectedRegistryRevision) {
        throw new Error("identity_registry_revision_conflict");
      }
      if (entity.migration_state !== normalized.from) throw new Error("identity_state_conflict");
      this.requireCurrentMarkers(
        normalized.entityType,
        normalized.entityId,
        normalized.expectedRegistryRevision,
      );
      const table = normalized.entityType === "principal" ? "principals" : "conversation_resources";
      const idColumn = normalized.entityType === "principal" ? "principal_id" : "resource_id";
      this.ctx.storage.sql.exec(
        `UPDATE ${table} SET migration_state = ?, revision = revision + 1, updated_at = ? WHERE ${idColumn} = ?`,
        normalized.to,
        now,
        normalized.entityId,
      );
      const result: IdentityStateAdvanceResultV1 = {
        version: 1,
        entityType: normalized.entityType,
        entityId: normalized.entityId,
        migrationState: normalized.to,
        registryRevision: normalized.expectedRegistryRevision + 1,
      };
      this.writeOperation(normalized.operationId, "identity.state-advance", fingerprint, result, now);
      return result;
    });
  }

  async reconcilePrincipalIdentity(input: unknown): Promise<IdentityReconciliationResultV1> {
    const normalized = decodeReconcilePrincipalIdentityInput(input);
    if (!normalized) throw new Error("identity_reconciliation_input_invalid");
    await this.registerObject();
    const fingerprint = await operationFingerprint("identity.reconcile-principal", normalized);
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const replay = this.readOperation<IdentityReconciliationResultV1>(
        normalized.operationId,
        "identity.reconcile-principal",
        fingerprint,
      );
      if (replay) return replay;
      const principal = this.readPrincipal(normalized.principalId);
      if (!principal || principal.lifecycle_state !== "active") throw new Error("identity_principal_missing");
      if (principal.revision !== normalized.expectedRegistryRevision) {
        throw new Error("identity_registry_revision_conflict");
      }
      const issues: IdentityReconciliationIssueV1[] = [];
      const markerCount = this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM identity_migration_markers
         WHERE entity_type = 'principal' AND entity_id = ? AND registry_revision = ?
           AND principal_revision = ? AND marker_kind IN ('root', 'user_state')`,
        normalized.principalId,
        normalized.expectedRegistryRevision,
        normalized.expectedRegistryRevision,
      ).one().count;
      if (markerCount !== 2) issues.push({ code: "principal_marker_missing", count: 2 - Math.min(2, markerCount) });
      const totalResources = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM conversation_resources WHERE principal_id = ?",
        normalized.principalId,
      ).one().count;
      const checkedConversations = normalized.conversations.length;
      if (totalResources > checkedConversations) {
        issues.push({ code: "conversation_check_bounded", count: totalResources - checkedConversations });
      }
      for (const conversation of normalized.conversations) {
        const resource = this.readConversationResource(normalized.principalId, conversation.conversationId);
        if (!resource) {
          issues.push({ code: "resource_missing", count: 1 });
        } else if (resource.agent_instance_name !== conversation.expectedAgentInstance) {
          issues.push({ code: "agent_instance_mismatch", count: 1 });
        } else {
          const resourceMarkerCount = this.ctx.storage.sql.exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM identity_migration_markers
             WHERE entity_type = 'resource' AND entity_id = ? AND registry_revision = ?
               AND principal_revision = ? AND marker_kind = 'conversation'`,
            resource.resource_id,
            resource.revision,
            principal.revision,
          ).one().count;
          if (resourceMarkerCount !== 1) issues.push({ code: "resource_marker_missing", count: 1 });
          if (resource.migration_state !== "authoritative") {
            issues.push({ code: "resource_not_authoritative", count: 1 });
          }
        }
      }
      const eligibleForAuthority = issues.length === 0 && totalResources === checkedConversations;
      const result: IdentityReconciliationResultV1 = {
        version: 1,
        operationId: normalized.operationId,
        principalId: normalized.principalId,
        registryRevision: principal.revision,
        migrationState: principal.migration_state,
        checkedConversations,
        totalResources,
        issues,
        digest: fingerprint,
        eligibleForAuthority,
        authoritative: eligibleForAuthority && principal.migration_state === "authoritative",
      };
      this.writeOperation(normalized.operationId, "identity.reconcile-principal", fingerprint, result, now);
      return result;
    });
  }

  async inspect(): Promise<IdentityRegistryInspectionV1> {
    await this.registerObject();
    const principalCounts = this.ctx.storage.sql.exec<{ lifecycle_state: IdentityLifecycleState; count: number }>(
      "SELECT lifecycle_state, COUNT(*) AS count FROM principals GROUP BY lifecycle_state",
    ).toArray();
    const aliasCounts = this.ctx.storage.sql.exec<{ state: IdentityLifecycleState; count: number }>(
      "SELECT state, COUNT(*) AS count FROM principal_aliases GROUP BY state",
    ).toArray();
    const migrationCounts = this.ctx.storage.sql.exec<{ migration_state: IdentityMigrationState; count: number }>(
      `SELECT migration_state, COUNT(*) AS count FROM (
         SELECT migration_state FROM principals UNION ALL
         SELECT migration_state FROM conversation_resources
       ) GROUP BY migration_state`,
    ).toArray();
    return {
      version: 1,
      schemaVersion: `identity-registry-v${IDENTITY_REGISTRY_SCHEMA_VERSION}`,
      principals: countLifecycle(principalCounts, "lifecycle_state"),
      aliases: countLifecycle(aliasCounts, "state"),
      resources: this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM conversation_resources",
      ).one().count,
      acl: {
        active: this.ctx.storage.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM conversation_acl_entries WHERE state = 'active'",
        ).one().count,
        revoked: this.ctx.storage.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM conversation_acl_entries WHERE state = 'revoked'",
        ).one().count,
        events: this.ctx.storage.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM conversation_acl_events",
        ).one().count,
      },
      migration: {
        backfilled: migrationCounts.find((row) => row.migration_state === "backfilled")?.count ?? 0,
        reconciled: migrationCounts.find((row) => row.migration_state === "reconciled")?.count ?? 0,
        authoritative: migrationCounts.find((row) => row.migration_state === "authoritative")?.count ?? 0,
      },
    };
  }

  async captureInstanceState(captureEpoch: string) {
    if (!isCaptureEpoch(captureEpoch)) throw new Error("capture_epoch_invalid");
    return captureDurableObjectState(
      this.ctx.storage,
      `identity-registry-v${IDENTITY_REGISTRY_SCHEMA_VERSION}`,
      (table) => IDENTITY_REGISTRY_TABLES.has(table),
    );
  }

  private resolveAccessSnapshot(
    actorPrincipalId: string,
    resourceId: string,
    conversationId: string,
    action: ConversationAccessActionV1,
    expectedAccessRevision?: number,
  ): ConversationAccessSnapshotV1 {
    const actor = this.readPrincipal(actorPrincipalId);
    const resource = this.readResourceById(resourceId);
    if (
      !actor || actor.lifecycle_state !== "active" || !resource
      || resource.conversation_id !== conversationId
    ) throw new Error("conversation_not_found");
    const owner = this.readPrincipal(resource.principal_id);
    if (!owner || owner.lifecycle_state !== "active") throw new Error("conversation_not_found");
    let role: ConversationAccessRoleV1;
    let grantRevision: number;
    if (actorPrincipalId === resource.principal_id) {
      role = "owner";
      grantRevision = 0;
    } else {
      const grant = this.readAclEntry(resource.resource_id, actorPrincipalId);
      if (!grant || grant.state !== "active") throw new Error("conversation_not_found");
      role = grant.role;
      grantRevision = grant.grant_revision;
    }
    if (
      expectedAccessRevision !== undefined
      && resource.access_revision !== expectedAccessRevision
    ) throw new Error("conversation_access_revision_conflict");
    if (!conversationAccessRoleAllowsAction(role, action)) {
      throw new Error("conversation_action_denied");
    }
    return {
      version: 1,
      resourceId: resource.resource_id,
      conversationId: resource.conversation_id,
      ownerPrincipalId: resource.principal_id,
      actorPrincipalId,
      role,
      accessRevision: resource.access_revision,
      grantRevision,
      agentInstanceName: resource.agent_instance_name,
      ownerRootInstanceName: owner.root_instance_name,
    };
  }

  private requireAclMutationAuthority(
    actorPrincipalId: string,
    resourceId: string,
    expectedAccessRevision: number,
  ): ConversationResourceRow {
    const resource = this.readResourceById(resourceId);
    if (!resource) throw new Error("conversation_not_found");
    this.resolveAccessSnapshot(
      actorPrincipalId,
      resource.resource_id,
      resource.conversation_id,
      "conversation.acl.mutate",
      expectedAccessRevision,
    );
    return resource;
  }

  private readAclEntry(
    resourceId: string,
    targetPrincipalId: string,
  ): ConversationAclEntryRow | undefined {
    return this.ctx.storage.sql.exec<ConversationAclEntryRow>(
      `SELECT * FROM conversation_acl_entries
       WHERE resource_id = ? AND grantee_principal_id = ?`,
      resourceId,
      targetPrincipalId,
    ).toArray()[0];
  }

  private readGrantList(resource: ConversationResourceRow): ConversationGrantListV1 {
    const rows = this.ctx.storage.sql.exec<ConversationGrantRow>(
      `SELECT acl.*, aliases.alias
       FROM conversation_acl_entries acl
       JOIN principals p
         ON p.principal_id = acl.grantee_principal_id AND p.lifecycle_state = 'active'
       JOIN principal_aliases aliases
         ON aliases.principal_id = acl.grantee_principal_id AND aliases.state = 'active'
       WHERE acl.resource_id = ? AND acl.state = 'active'
       ORDER BY aliases.alias ASC, acl.grantee_principal_id ASC`,
      resource.resource_id,
    ).toArray();
    return {
      version: 1,
      resourceId: resource.resource_id,
      accessRevision: resource.access_revision,
      grants: rows.map(conversationGrantFromRow),
    };
  }

  private revokeActiveGrantsForRetiredPrincipal(principalId: string, retiredAt: number): void {
    const grants = this.ctx.storage.sql.exec<ConversationAclEntryRow>(
      `SELECT * FROM conversation_acl_entries
       WHERE grantee_principal_id = ? AND state = 'active'
       ORDER BY resource_id ASC`,
      principalId,
    ).toArray();
    for (const grant of grants) {
      const resource = this.readResourceById(grant.resource_id);
      if (!resource) throw new Error("identity_resource_missing");
      const accessRevision = resource.access_revision + 1;
      this.ctx.storage.sql.exec(
        "UPDATE conversation_resources SET access_revision = ?, updated_at = ? WHERE resource_id = ?",
        accessRevision,
        retiredAt,
        resource.resource_id,
      );
      this.ctx.storage.sql.exec(
        `UPDATE conversation_acl_entries
         SET state = 'revoked', revoke_revision = ?, revoked_by_principal_id = NULL,
             updated_at = ?, revoked_at = ?
         WHERE resource_id = ? AND grantee_principal_id = ?`,
        accessRevision,
        retiredAt,
        retiredAt,
        resource.resource_id,
        principalId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO conversation_acl_events(
          operation_id, resource_id, actor_principal_id, target_principal_id, event_type,
          before_role, after_role, access_revision, occurred_at
        ) VALUES (?, ?, ?, ?, 'revoke', ?, NULL, ?, ?)`,
        `principal-retire:${principalId}:${resource.resource_id}:${accessRevision}`,
        resource.resource_id,
        null,
        principalId,
        grant.role,
        accessRevision,
        retiredAt,
      );
    }
  }

  private readPrincipal(principalId: string): PrincipalRow | undefined {
    return this.ctx.storage.sql.exec<PrincipalRow>(
      "SELECT * FROM principals WHERE principal_id = ?",
      principalId,
    ).toArray()[0];
  }

  private readPrincipalByActiveAlias(alias: string): PrincipalRouteRow | undefined {
    return this.ctx.storage.sql.exec<PrincipalRouteRow>(
      `SELECT p.*, a.alias
       FROM principals p JOIN principal_aliases a ON a.principal_id = p.principal_id
       WHERE a.alias = ? AND a.state = 'active' AND p.lifecycle_state = 'active'`,
      alias,
    ).toArray()[0];
  }

  private readPrincipalByAlias(principalId: string, alias: string): PrincipalRouteRow | undefined {
    return this.ctx.storage.sql.exec<PrincipalRouteRow>(
      `SELECT p.*, a.alias
       FROM principals p JOIN principal_aliases a ON a.principal_id = p.principal_id
       WHERE p.principal_id = ? AND a.alias = ?
       ORDER BY a.created_at DESC LIMIT 1`,
      principalId,
      alias,
    ).toArray()[0];
  }

  private readConversationResource(principalId: string, conversationId: string): ConversationResourceRow | undefined {
    return this.ctx.storage.sql.exec<ConversationResourceRow>(
      "SELECT * FROM conversation_resources WHERE principal_id = ? AND conversation_id = ?",
      principalId,
      conversationId,
    ).toArray()[0];
  }

  private readResourceById(resourceId: string): ConversationResourceRow | undefined {
    return this.ctx.storage.sql.exec<ConversationResourceRow>(
      "SELECT * FROM conversation_resources WHERE resource_id = ?",
      resourceId,
    ).toArray()[0];
  }

  private requireCurrentMarkers(
    entityType: "principal" | "resource",
    entityId: string,
    registryRevision: number,
  ): void {
    const requiredKinds = entityType === "principal" ? ["root", "user_state"] : ["conversation"];
    const principalRevision = entityType === "principal"
      ? registryRevision
      : this.readPrincipal(this.readResourceById(entityId)?.principal_id || "")?.revision;
    if (!principalRevision) throw new Error("identity_principal_missing");
    const rows = this.ctx.storage.sql.exec<{ marker_kind: string }>(
      `SELECT marker_kind FROM identity_migration_markers
       WHERE entity_type = ? AND entity_id = ? AND registry_revision = ? AND principal_revision = ?`,
      entityType,
      entityId,
      registryRevision,
      principalRevision,
    ).toArray();
    const actual = new Set(rows.map((row) => row.marker_kind));
    if (requiredKinds.some((kind) => !actual.has(kind))) throw new Error("identity_marker_missing");
  }

  private readOperation<T>(
    operationId: string,
    operationKind: string,
    fingerprint: string,
    conflictCode = "identity_operation_conflict",
  ): T | undefined {
    const row = this.ctx.storage.sql.exec<IdentityOperationRow>(
      "SELECT operation_kind, fingerprint, result_json FROM identity_operations WHERE operation_id = ?",
      operationId,
    ).toArray()[0];
    if (!row) return undefined;
    if (row.operation_kind !== operationKind || row.fingerprint !== fingerprint) {
      throw new Error(conflictCode);
    }
    return JSON.parse(row.result_json) as T;
  }

  private writeOperation(
    operationId: string,
    operationKind: string,
    fingerprint: string,
    result: unknown,
    createdAt: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO identity_operations(operation_id, operation_kind, fingerprint, result_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      operationId,
      operationKind,
      fingerprint,
      JSON.stringify(result),
      createdAt,
    );
  }

  private async registerObject(): Promise<void> {
    const result = await this.env.INSTANCE_COORDINATOR
      .getByName(INSTANCE_MAINTENANCE_COORDINATOR)
      .registerObject({
        version: 1,
        kind: "identity_registry",
        instanceName: IDENTITY_REGISTRY_INSTANCE_NAME,
        rootInstanceName: "",
        schemaVersion: `identity-registry-v${IDENTITY_REGISTRY_SCHEMA_VERSION}`,
        stateClass: "authoritative",
        restoreBehavior: "restore",
        registeredAt: Date.now(),
      });
    if (!result.ok) throw new Error(result.error);
  }

  private applySchemaMigrations(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS identity_schema_migrations(
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      const current = this.ctx.storage.sql.exec<{ version: number }>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM identity_schema_migrations",
      ).one().version;
      if (current < 1) {
        this.ctx.storage.sql.exec(`
          CREATE TABLE principals(
            principal_id TEXT PRIMARY KEY,
            origin TEXT NOT NULL CHECK(origin IN ('legacy', 'native')),
            lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('active', 'retired')),
            migration_state TEXT NOT NULL CHECK(migration_state IN ('backfilled', 'reconciled', 'authoritative')),
            root_instance_name TEXT NOT NULL UNIQUE,
            user_state_instance_name TEXT NOT NULL UNIQUE,
            revision INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE TABLE principal_aliases(
            binding_id TEXT PRIMARY KEY,
            alias TEXT NOT NULL,
            principal_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('active', 'retired')),
            created_at INTEGER NOT NULL,
            retired_at INTEGER NOT NULL,
            revision INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX principal_aliases_active_idx
            ON principal_aliases(alias) WHERE state = 'active';
          CREATE INDEX principal_aliases_principal_idx
            ON principal_aliases(principal_id, state);
          CREATE TABLE conversation_resources(
            resource_id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            agent_instance_name TEXT NOT NULL UNIQUE,
            migration_state TEXT NOT NULL CHECK(migration_state IN ('backfilled', 'reconciled', 'authoritative')),
            revision INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(principal_id, conversation_id)
          );
          CREATE INDEX conversation_resources_principal_idx
            ON conversation_resources(principal_id, resource_id);
          CREATE TABLE identity_migration_markers(
            entity_type TEXT NOT NULL CHECK(entity_type IN ('principal', 'resource')),
            entity_id TEXT NOT NULL,
            marker_kind TEXT NOT NULL CHECK(marker_kind IN ('root', 'user_state', 'conversation')),
            pinned_instance_name TEXT NOT NULL,
            registry_revision INTEGER NOT NULL,
            principal_revision INTEGER NOT NULL,
            digest TEXT NOT NULL,
            recorded_at INTEGER NOT NULL,
            PRIMARY KEY(entity_type, entity_id, marker_kind, registry_revision, principal_revision)
          );
          CREATE TABLE identity_operations(
            operation_id TEXT PRIMARY KEY,
            operation_kind TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO identity_schema_migrations(version, applied_at) VALUES (1, ?)",
          Date.now(),
        );
      }
      if (current < 2) {
        this.ctx.storage.sql.exec(`
          ALTER TABLE conversation_resources
            ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 1;
          CREATE TABLE conversation_acl_entries(
            resource_id TEXT NOT NULL,
            grantee_principal_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
            state TEXT NOT NULL CHECK(state IN ('active', 'revoked')),
            grant_revision INTEGER NOT NULL CHECK(grant_revision > 0),
            revoke_revision INTEGER CHECK(revoke_revision IS NULL OR revoke_revision > grant_revision),
            granted_by_principal_id TEXT NOT NULL,
            revoked_by_principal_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            revoked_at INTEGER,
            PRIMARY KEY(resource_id, grantee_principal_id),
            CHECK(
              (state = 'active' AND revoke_revision IS NULL
                AND revoked_by_principal_id IS NULL AND revoked_at IS NULL)
              OR
              (state = 'revoked' AND revoke_revision IS NOT NULL AND revoked_at IS NOT NULL)
            )
          );
          CREATE INDEX conversation_acl_active_grantee_idx
            ON conversation_acl_entries(grantee_principal_id, resource_id)
            WHERE state = 'active';
          CREATE TABLE conversation_acl_events(
            operation_id TEXT PRIMARY KEY,
            resource_id TEXT NOT NULL,
            actor_principal_id TEXT,
            target_principal_id TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('grant', 'role_change', 'revoke')),
            before_role TEXT CHECK(before_role IS NULL OR before_role IN ('editor', 'viewer')),
            after_role TEXT CHECK(after_role IS NULL OR after_role IN ('editor', 'viewer')),
            access_revision INTEGER NOT NULL CHECK(access_revision > 1),
            occurred_at INTEGER NOT NULL,
            CHECK(
              (event_type = 'grant' AND before_role IS NULL AND after_role IS NOT NULL)
              OR
              (event_type = 'role_change' AND before_role IS NOT NULL AND after_role IS NOT NULL
                AND before_role <> after_role)
              OR
              (event_type = 'revoke' AND before_role IS NOT NULL AND after_role IS NULL)
            )
          );
          CREATE UNIQUE INDEX conversation_acl_events_resource_revision_idx
            ON conversation_acl_events(resource_id, access_revision);
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO identity_schema_migrations(version, applied_at) VALUES (2, ?)",
          Date.now(),
        );
      }
    });
  }
}

function principalRouteFromRow(row: PrincipalRouteRow): PrincipalRouteV1 {
  return {
    version: 1,
    principalId: row.principal_id,
    alias: row.alias,
    origin: row.origin,
    lifecycleState: row.lifecycle_state,
    migrationState: row.migration_state,
    rootInstanceName: row.root_instance_name,
    userStateInstanceName: row.user_state_instance_name,
    registryRevision: row.revision,
  };
}

function conversationRouteFromRow(row: ConversationResourceRow): ConversationResourceRouteV1 {
  return {
    version: 1,
    resourceId: row.resource_id,
    principalId: row.principal_id,
    conversationId: row.conversation_id,
    migrationState: row.migration_state,
    agentInstanceName: row.agent_instance_name,
    registryRevision: row.revision,
  };
}

function conversationAccessRouteFromRow(row: ConversationAccessRouteRow) {
  return {
    version: 1 as const,
    resourceId: row.resource_id,
    conversationId: row.conversation_id,
    ownerPrincipalId: row.principal_id,
    role: row.role,
    accessRevision: row.access_revision,
    grantRevision: row.grant_revision,
    agentInstanceName: row.agent_instance_name,
    ownerRootInstanceName: row.owner_root_instance_name,
  };
}

function conversationGrantFromRow(row: ConversationGrantRow): ConversationGrantV1 {
  return {
    principalId: row.grantee_principal_id,
    alias: row.alias,
    role: row.role,
    grantRevision: row.grant_revision,
    grantedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function operationFingerprint(kind: string, value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson({ kind, value })),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function countLifecycle<T extends Record<K, IdentityLifecycleState>, K extends keyof T>(
  rows: Array<T & { count: number }>,
  key: K,
): { active: number; retired: number } {
  return {
    active: rows.find((row) => row[key] === "active")?.count ?? 0,
    retired: rows.find((row) => row[key] === "retired")?.count ?? 0,
  };
}

function isCaptureEpoch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value);
}
