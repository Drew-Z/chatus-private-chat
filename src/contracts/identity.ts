export const IDENTITY_REGISTRY_SCHEMA_VERSION = 1 as const;

export type IdentityOrigin = "legacy" | "native";
export type IdentityMigrationState = "backfilled" | "reconciled" | "authoritative";
export type IdentityLifecycleState = "active" | "retired";

export type PrincipalRouteV1 = {
  version: 1;
  principalId: string;
  alias: string;
  origin: IdentityOrigin;
  lifecycleState: IdentityLifecycleState;
  migrationState: IdentityMigrationState;
  rootInstanceName: string;
  userStateInstanceName: string;
  registryRevision: number;
};

export type ConversationResourceRouteV1 = {
  version: 1;
  resourceId: string;
  principalId: string;
  conversationId: string;
  migrationState: IdentityMigrationState;
  agentInstanceName: string;
  registryRevision: number;
};

export type ResolveOrCreatePrincipalInputV1 = {
  version: 1;
  operationId: string;
  alias: string;
  origin: IdentityOrigin;
  legacyRootInstance?: string;
  legacyUserStateInstance?: string;
};

export type ResolvePrincipalSessionInputV1 = {
  version: 1;
  principalId: string;
  alias: string;
};

export type ResolveActivePrincipalAliasInputV1 = {
  version: 1;
  alias: string;
};

export type RetirePrincipalAliasInputV1 = {
  version: 1;
  operationId: string;
  principalId: string;
  alias: string;
  retiredAt: number;
};

export type EnsureConversationResourceInputV1 = {
  version: 1;
  operationId: string;
  principalId: string;
  conversationId: string;
  legacyAgentInstance?: string;
};

export type ResolveConversationResourceInputV1 = {
  version: 1;
  principalId: string;
  conversationId: string;
};

export type StableIdentityMarkerKind = "root" | "user_state" | "conversation";

export type StablePrincipalIdentityV1 = {
  version: 1;
  principalId: string;
  rootInstanceName: string;
  userStateInstanceName: string;
  registryRevision: number;
};

export type StableTeamAgentIdentityV1 = StablePrincipalIdentityV1 & {
  scope: "root" | "conversation";
  resourceId: string;
  resourceRegistryRevision: number;
  pinnedInstanceName: string;
};

export type RecordStableIdentityMarkerInputV1 = {
  version: 1;
  entityType: "principal" | "resource";
  entityId: string;
  markerKind: StableIdentityMarkerKind;
  pinnedInstanceName: string;
  expectedRegistryRevision: number;
  expectedPrincipalRevision: number;
  digest: string;
  recordedAt: number;
};

export type AdvanceIdentityStateInputV1 = {
  version: 1;
  operationId: string;
  entityType: "principal" | "resource";
  entityId: string;
  expectedRegistryRevision: number;
  from: IdentityMigrationState;
  to: IdentityMigrationState;
};

export type ReconcilePrincipalIdentityConversationV1 = {
  conversationId: string;
  expectedAgentInstance: string;
};

export type ReconcilePrincipalIdentityInputV1 = {
  version: 1;
  operationId: string;
  principalId: string;
  expectedRegistryRevision: number;
  conversations: ReconcilePrincipalIdentityConversationV1[];
};

export type IdentityReconciliationIssueCodeV1 =
  | "resource_missing"
  | "agent_instance_mismatch"
  | "resource_marker_missing"
  | "resource_not_authoritative"
  | "conversation_check_bounded"
  | "principal_marker_missing";

export type IdentityReconciliationIssueV1 = {
  code: IdentityReconciliationIssueCodeV1;
  count: number;
};

export type IdentityReconciliationResultV1 = {
  version: 1;
  operationId: string;
  principalId: string;
  registryRevision: number;
  migrationState: IdentityMigrationState;
  checkedConversations: number;
  totalResources: number;
  issues: IdentityReconciliationIssueV1[];
  digest: string;
  eligibleForAuthority: boolean;
  authoritative: boolean;
};

const MEMBER_ALIAS_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const PRINCIPAL_ID_PATTERN = /^prn_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID_PATTERN = /^res_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOUNDED_ID_PATTERN = /^[A-Za-z0-9$][A-Za-z0-9$:._/-]{0,159}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function createPrincipalId(): string {
  return `prn_${crypto.randomUUID()}`;
}

export function createConversationResourceId(): string {
  return `res_${crypto.randomUUID()}`;
}

export function principalRootInstanceName(principalId: string): string {
  if (!isPrincipalId(principalId)) throw new Error("identity_principal_id_invalid");
  return `root-${principalId}`;
}

export function principalUserStateInstanceName(principalId: string): string {
  if (!isPrincipalId(principalId)) throw new Error("identity_principal_id_invalid");
  return `state-${principalId}`;
}

export function conversationResourceInstanceName(resourceId: string): string {
  if (!isResourceId(resourceId)) throw new Error("identity_resource_id_invalid");
  return `conversation-${resourceId}`;
}

export function normalizeMemberAlias(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const alias = value.trim();
  return MEMBER_ALIAS_PATTERN.test(alias) ? alias : undefined;
}

export function isPrincipalId(value: unknown): value is string {
  return typeof value === "string" && PRINCIPAL_ID_PATTERN.test(value);
}

export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID_PATTERN.test(value);
}

export function decodeResolveOrCreatePrincipalInput(
  value: unknown,
): ResolveOrCreatePrincipalInputV1 | undefined {
  if (!hasOnlyKeys(value, [
    "version", "operationId", "alias", "origin", "legacyRootInstance", "legacyUserStateInstance",
  ])) return undefined;
  const alias = normalizeMemberAlias(value.alias);
  const operationId = normalizeBoundedId(value.operationId);
  const legacyRootInstance = optionalBoundedId(value.legacyRootInstance);
  const legacyUserStateInstance = optionalBoundedId(value.legacyUserStateInstance);
  if (
    value.version !== 1 || !operationId || !alias
    || (value.origin !== "legacy" && value.origin !== "native")
    || legacyRootInstance === null || legacyUserStateInstance === null
    || (value.origin === "legacy" && (!legacyRootInstance || !legacyUserStateInstance))
    || (value.origin === "native" && (legacyRootInstance !== undefined || legacyUserStateInstance !== undefined))
  ) return undefined;
  return {
    version: 1,
    operationId,
    alias,
    origin: value.origin,
    ...(legacyRootInstance ? { legacyRootInstance } : {}),
    ...(legacyUserStateInstance ? { legacyUserStateInstance } : {}),
  };
}

export function decodeResolvePrincipalSessionInput(
  value: unknown,
): ResolvePrincipalSessionInputV1 | undefined {
  if (!hasExactKeys(value, ["version", "principalId", "alias"])) return undefined;
  const alias = normalizeMemberAlias(value.alias);
  if (value.version !== 1 || !isPrincipalId(value.principalId) || !alias) return undefined;
  return { version: 1, principalId: value.principalId, alias };
}

export function decodeResolveActivePrincipalAliasInput(
  value: unknown,
): ResolveActivePrincipalAliasInputV1 | undefined {
  if (!hasExactKeys(value, ["version", "alias"])) return undefined;
  const alias = normalizeMemberAlias(value.alias);
  if (value.version !== 1 || !alias) return undefined;
  return { version: 1, alias };
}

export function decodeRetirePrincipalAliasInput(
  value: unknown,
): RetirePrincipalAliasInputV1 | undefined {
  if (!hasExactKeys(value, ["version", "operationId", "principalId", "alias", "retiredAt"])) return undefined;
  const operationId = normalizeBoundedId(value.operationId);
  const alias = normalizeMemberAlias(value.alias);
  if (
    value.version !== 1 || !operationId || !isPrincipalId(value.principalId) || !alias
    || !isTimestamp(value.retiredAt)
  ) return undefined;
  return { version: 1, operationId, principalId: value.principalId, alias, retiredAt: value.retiredAt };
}

export function decodeEnsureConversationResourceInput(
  value: unknown,
): EnsureConversationResourceInputV1 | undefined {
  if (!hasOnlyKeys(value, [
    "version", "operationId", "principalId", "conversationId", "legacyAgentInstance",
  ])) return undefined;
  const operationId = normalizeBoundedId(value.operationId);
  const conversationId = normalizeBoundedId(value.conversationId);
  const legacyAgentInstance = optionalBoundedId(value.legacyAgentInstance);
  if (
    value.version !== 1 || !operationId || !isPrincipalId(value.principalId) || !conversationId
    || legacyAgentInstance === null
  ) return undefined;
  return {
    version: 1,
    operationId,
    principalId: value.principalId,
    conversationId,
    ...(legacyAgentInstance ? { legacyAgentInstance } : {}),
  };
}

export function decodeResolveConversationResourceInput(
  value: unknown,
): ResolveConversationResourceInputV1 | undefined {
  if (!hasExactKeys(value, ["version", "principalId", "conversationId"])) return undefined;
  const conversationId = normalizeBoundedId(value.conversationId);
  if (value.version !== 1 || !isPrincipalId(value.principalId) || !conversationId) return undefined;
  return { version: 1, principalId: value.principalId, conversationId };
}

export function decodeRecordStableIdentityMarkerInput(
  value: unknown,
): RecordStableIdentityMarkerInputV1 | undefined {
  if (!hasExactKeys(value, [
    "version", "entityType", "entityId", "markerKind", "pinnedInstanceName",
    "expectedRegistryRevision", "expectedPrincipalRevision", "digest", "recordedAt",
  ])) return undefined;
  const entityType = value.entityType;
  const entityId = value.entityId;
  const markerKind = value.markerKind;
  const pinnedInstanceName = normalizeBoundedId(value.pinnedInstanceName);
  if (
    value.version !== 1 || (entityType !== "principal" && entityType !== "resource")
    || typeof entityId !== "string"
    || (entityType === "principal" ? !isPrincipalId(entityId) : !isResourceId(entityId))
    || (markerKind !== "root" && markerKind !== "user_state" && markerKind !== "conversation")
    || (entityType === "principal" && markerKind === "conversation")
    || (entityType === "resource" && markerKind !== "conversation")
    || !pinnedInstanceName || !isPositiveInteger(value.expectedRegistryRevision)
    || !isPositiveInteger(value.expectedPrincipalRevision)
    || (entityType === "principal" && value.expectedPrincipalRevision !== value.expectedRegistryRevision)
    || typeof value.digest !== "string" || !DIGEST_PATTERN.test(value.digest)
    || !isTimestamp(value.recordedAt)
  ) return undefined;
  return {
    version: 1,
    entityType,
    entityId,
    markerKind,
    pinnedInstanceName,
    expectedRegistryRevision: value.expectedRegistryRevision,
    expectedPrincipalRevision: value.expectedPrincipalRevision,
    digest: value.digest,
    recordedAt: value.recordedAt,
  };
}

export function decodeStablePrincipalIdentity(
  value: unknown,
): StablePrincipalIdentityV1 | undefined {
  if (!hasExactKeys(value, [
    "version", "principalId", "rootInstanceName", "userStateInstanceName", "registryRevision",
  ])) return undefined;
  const rootInstanceName = normalizeBoundedId(value.rootInstanceName);
  const userStateInstanceName = normalizeBoundedId(value.userStateInstanceName);
  if (
    value.version !== 1 || !isPrincipalId(value.principalId) || !rootInstanceName || !userStateInstanceName
    || !isPositiveInteger(value.registryRevision)
  ) return undefined;
  return {
    version: 1,
    principalId: value.principalId,
    rootInstanceName,
    userStateInstanceName,
    registryRevision: value.registryRevision,
  };
}

export function decodeStableTeamAgentIdentity(
  value: unknown,
): StableTeamAgentIdentityV1 | undefined {
  if (!hasExactKeys(value, [
    "version", "principalId", "rootInstanceName", "userStateInstanceName", "registryRevision",
    "scope", "resourceId", "resourceRegistryRevision", "pinnedInstanceName",
  ])) return undefined;
  const principal = decodeStablePrincipalIdentity({
    version: value.version,
    principalId: value.principalId,
    rootInstanceName: value.rootInstanceName,
    userStateInstanceName: value.userStateInstanceName,
    registryRevision: value.registryRevision,
  });
  const pinnedInstanceName = normalizeBoundedId(value.pinnedInstanceName);
  if (
    !principal || (value.scope !== "root" && value.scope !== "conversation") || !pinnedInstanceName
    || typeof value.resourceId !== "string"
    || typeof value.resourceRegistryRevision !== "number"
    || (value.scope === "root"
      ? value.resourceId !== "" || value.resourceRegistryRevision !== 0
      : !isResourceId(value.resourceId) || !isPositiveInteger(value.resourceRegistryRevision))
  ) return undefined;
  return {
    ...principal,
    scope: value.scope,
    resourceId: value.resourceId,
    resourceRegistryRevision: value.resourceRegistryRevision,
    pinnedInstanceName,
  };
}

export function decodeAdvanceIdentityStateInput(
  value: unknown,
): AdvanceIdentityStateInputV1 | undefined {
  if (!hasExactKeys(value, [
    "version", "operationId", "entityType", "entityId", "expectedRegistryRevision", "from", "to",
  ])) return undefined;
  const operationId = normalizeBoundedId(value.operationId);
  const entityType = value.entityType;
  const entityId = value.entityId;
  if (
    value.version !== 1 || !operationId || (entityType !== "principal" && entityType !== "resource")
    || typeof entityId !== "string"
    || (entityType === "principal" ? !isPrincipalId(entityId) : !isResourceId(entityId))
    || !isPositiveInteger(value.expectedRegistryRevision)
    || !isMigrationState(value.from) || !isMigrationState(value.to)
    || !isOneStepTransition(value.from, value.to)
  ) return undefined;
  return {
    version: 1,
    operationId,
    entityType,
    entityId,
    expectedRegistryRevision: value.expectedRegistryRevision,
    from: value.from,
    to: value.to,
  };
}

export function decodeReconcilePrincipalIdentityInput(
  value: unknown,
): ReconcilePrincipalIdentityInputV1 | undefined {
  if (!hasExactKeys(value, [
    "version", "operationId", "principalId", "expectedRegistryRevision", "conversations",
  ])) return undefined;
  const operationId = normalizeBoundedId(value.operationId);
  if (
    value.version !== 1
    || !operationId
    || !isPrincipalId(value.principalId)
    || !isPositiveInteger(value.expectedRegistryRevision)
    || !Array.isArray(value.conversations)
    || value.conversations.length > 50
  ) return undefined;
  const conversations: ReconcilePrincipalIdentityConversationV1[] = [];
  const seen = new Set<string>();
  for (const item of value.conversations) {
    if (!hasExactKeys(item, ["conversationId", "expectedAgentInstance"])) return undefined;
    const conversationId = normalizeBoundedId(item.conversationId);
    const expectedAgentInstance = normalizeBoundedId(item.expectedAgentInstance);
    if (!conversationId || !expectedAgentInstance || seen.has(conversationId)) return undefined;
    seen.add(conversationId);
    conversations.push({ conversationId, expectedAgentInstance });
  }
  return {
    version: 1,
    operationId,
    principalId: value.principalId,
    expectedRegistryRevision: value.expectedRegistryRevision,
    conversations,
  };
}

export function isOneStepTransition(from: IdentityMigrationState, to: IdentityMigrationState): boolean {
  return (from === "backfilled" && to === "reconciled")
    || (from === "reconciled" && to === "authoritative");
}

function isMigrationState(value: unknown): value is IdentityMigrationState {
  return value === "backfilled" || value === "reconciled" || value === "authoritative";
}

function normalizeBoundedId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return BOUNDED_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function optionalBoundedId(value: unknown): string | undefined | null {
  return value === undefined ? undefined : normalizeBoundedId(value) ?? null;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return hasOnlyKeys(value, expected) && Object.keys(value).length === expected.length;
}
