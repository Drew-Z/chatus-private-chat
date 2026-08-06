export const PROVIDER_FINANCE_SCHEMA_VERSION = 1 as const;

export const PROVIDER_FINANCE_DATA_POLICY = {
  backup: "authoritative_restore",
  accountDeletion: "retain_instance_operational_evidence",
  userExport: "excluded",
  retention: "no_automatic_expiry",
  rawInvoice: "excluded",
  memberVisibleMoney: "unsupported",
  hardBudgetEnforcement: "unsupported",
} as const;

export const PROVIDER_USAGE_TOKEN_FIELDS = [
  "inputNoCacheTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
  "outputTextTokens",
  "reasoningOutputTokens",
] as const;

export type ProviderUsageTokenField = (typeof PROVIDER_USAGE_TOKEN_FIELDS)[number];
export type ProviderUsageEvidenceMode = "cumulative" | "delta" | "missing";
export type ProviderUsageEvidenceClass = "reported" | "estimated" | "reconciled";
export type ProviderUsageEvidenceSource =
  | "ai_sdk_generate"
  | "ai_sdk_stream_finish"
  | "openai_sse"
  | "anthropic_sse"
  | "provider_tool"
  | "reconciliation";

export type ProviderTokenUsageV1 = Record<ProviderUsageTokenField, number | null>;

export type ProviderUsageEvidenceInputV1 = ProviderTokenUsageV1 & {
  version: 1;
  evidenceId: string;
  attemptId: string;
  mode: ProviderUsageEvidenceMode;
  evidenceClass: ProviderUsageEvidenceClass;
  source: ProviderUsageEvidenceSource;
  observedAt: number;
};

export type ProviderUsageEvidenceResultV1 = {
  created: boolean;
  evidenceId: string;
  effectiveDelta: ProviderTokenUsageV1;
};

export type ProviderPriceCatalogInputV1 = {
  version: 1;
  catalogVersionId: string;
  providerId: string;
  offeringId: string;
  model: string;
  currency: string;
  precision: number;
  unit: "million_tokens";
  inputNoCachePriceMicros: number | null;
  cacheReadInputPriceMicros: number | null;
  cacheWriteInputPriceMicros: number | null;
  outputTextPriceMicros: number | null;
  reasoningOutputPriceMicros: number | null;
  effectiveFrom: number;
  effectiveTo: number | null;
  approver: string;
  provenance: string;
  createdAt: number;
};

export type ProviderPriceCatalogResultV1 = {
  created: boolean;
  catalog: ProviderPriceCatalogInputV1;
};

export type ProviderCostEvidenceKind = "calculated" | "reversal" | "replacement" | "correction";
export type ProviderCostEvidenceClass = "estimated" | "reported" | "reconciled" | "corrected";

export type ProviderCostEvidenceInputV1 = {
  version: 1;
  eventId: string;
  attemptId: string;
  kind: ProviderCostEvidenceKind;
  evidenceClass: ProviderCostEvidenceClass;
  currency: string;
  amountMicros: number;
  supersedesEventId: string | null;
  sourceEvidenceId: string | null;
  observedAt: number;
};

export type ProviderCostEvidenceResultV1 = {
  created: boolean;
  event: ProviderCostEvidenceInputV1;
};

export type ProviderReconciliationStatus = "matched" | "partial" | "disputed" | "corrected" | "closed";

export type ProviderReconciliationImportInputV1 = {
  version: 1;
  fingerprint: string;
  providerId: string;
  accountFingerprint: string;
  periodStart: number;
  periodEnd: number;
  currency: string;
  reportedTotalMicros: number;
  matchedTotalMicros: number;
  status: ProviderReconciliationStatus;
  importedAt: number;
};

export type ProviderReconciliationProjectionV1 = ProviderReconciliationImportInputV1 & {
  reconciliationId: string;
  revision: number;
  supersedesReconciliationId: string | null;
  unmatchedVarianceMicros: number;
};

export type ProviderReconciliationImportResultV1 = {
  created: boolean;
  reconciliation: ProviderReconciliationProjectionV1;
};

export type ProviderFinanceAttemptProjectionV1 = {
  attemptId: string;
  runKind: string;
  logicalRouteId: string;
  offeringId: string;
  model: string;
  fallbackIndex: number;
  status: string;
  errorClass: string;
  startedAt: number;
  endedAt: number;
  latencyMs: number | null;
  priceResolution: "matched" | "missing";
  catalogVersionId: string | null;
  usageState: "unknown" | "partial" | "reported" | "estimated" | "reconciled";
  usage: ProviderTokenUsageV1;
  costState: "unknown" | "provisional" | "settled" | "corrected";
  costs: Array<{
    currency: string;
    provisionalMicros: number;
    settledMicros: number;
    correctedMicros: number;
    totalMicros: number;
  }>;
};

export type ProviderFinanceSnapshotV1 = {
  version: 1;
  providerId: string;
  generatedAt: number;
  periodStart: number;
  capacity: {
    calls: number;
    succeeded: number;
    failures: number;
    retries: number;
    fallbacks: number;
    averageLatencyMs: number | null;
    unknownUsageAttempts: number;
    provisionalCostAttempts: number;
  };
  usage: ProviderTokenUsageV1;
  costs: Array<{
    currency: string;
    provisionalMicros: number;
    settledMicros: number;
    correctedMicros: number;
    totalMicros: number;
    unknownAttempts: number;
  }>;
  attempts: ProviderFinanceAttemptProjectionV1[];
  reconciliations: ProviderReconciliationProjectionV1[];
  catalogs: ProviderPriceCatalogInputV1[];
};

const USAGE_KEYS = [
  "version",
  "evidenceId",
  "attemptId",
  "mode",
  "evidenceClass",
  "source",
  "observedAt",
  ...PROVIDER_USAGE_TOKEN_FIELDS,
] as const;
const PRICE_KEYS = [
  "version",
  "catalogVersionId",
  "providerId",
  "offeringId",
  "model",
  "currency",
  "precision",
  "unit",
  "inputNoCachePriceMicros",
  "cacheReadInputPriceMicros",
  "cacheWriteInputPriceMicros",
  "outputTextPriceMicros",
  "reasoningOutputPriceMicros",
  "effectiveFrom",
  "effectiveTo",
  "approver",
  "provenance",
  "createdAt",
] as const;
const COST_KEYS = [
  "version",
  "eventId",
  "attemptId",
  "kind",
  "evidenceClass",
  "currency",
  "amountMicros",
  "supersedesEventId",
  "sourceEvidenceId",
  "observedAt",
] as const;
const RECONCILIATION_KEYS = [
  "version",
  "fingerprint",
  "providerId",
  "accountFingerprint",
  "periodStart",
  "periodEnd",
  "currency",
  "reportedTotalMicros",
  "matchedTotalMicros",
  "status",
  "importedAt",
] as const;
const OPAQUE_ATTEMPT_ID = /^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/;
const CURRENCY = /^[A-Z]{3}$/;
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const ACCOUNT_FINGERPRINT = /^acct_sha256:[0-9a-f]{64}$/;

export function emptyProviderTokenUsage(): ProviderTokenUsageV1 {
  return {
    inputNoCacheTokens: null,
    cacheReadInputTokens: null,
    cacheWriteInputTokens: null,
    outputTextTokens: null,
    reasoningOutputTokens: null,
  };
}

export function decodeProviderUsageEvidenceInput(value: unknown): ProviderUsageEvidenceInputV1 | undefined {
  if (!isExactRecord(value, USAGE_KEYS)) return undefined;
  if (
    value.version !== 1
    || !isBoundedId(value.evidenceId)
    || typeof value.attemptId !== "string"
    || !OPAQUE_ATTEMPT_ID.test(value.attemptId)
    || (value.mode !== "cumulative" && value.mode !== "delta" && value.mode !== "missing")
    || (value.evidenceClass !== "reported" && value.evidenceClass !== "estimated" && value.evidenceClass !== "reconciled")
    || !isUsageSource(value.source)
    || !isTimestamp(value.observedAt)
    || !PROVIDER_USAGE_TOKEN_FIELDS.every((field) => isNullableCount(value[field]))
  ) return undefined;
  const usage = tokenUsageFromRecord(value);
  const hasKnown = PROVIDER_USAGE_TOKEN_FIELDS.some((field) => usage[field] !== null);
  if ((value.mode === "missing") === hasKnown) return undefined;
  return {
    version: 1,
    evidenceId: value.evidenceId,
    attemptId: value.attemptId,
    mode: value.mode,
    evidenceClass: value.evidenceClass,
    source: value.source,
    observedAt: value.observedAt,
    ...usage,
  };
}

export function decodeProviderPriceCatalogInput(value: unknown): ProviderPriceCatalogInputV1 | undefined {
  if (!isExactRecord(value, PRICE_KEYS)) return undefined;
  if (
    value.version !== 1
    || !isBoundedId(value.catalogVersionId)
    || !isBoundedId(value.providerId)
    || !isBoundedId(value.offeringId)
    || !isBoundedText(value.model, 240)
    || typeof value.currency !== "string"
    || !CURRENCY.test(value.currency)
    || !Number.isInteger(value.precision)
    || Number(value.precision) < 0
    || Number(value.precision) > 6
    || value.unit !== "million_tokens"
    || !isNullableCount(value.inputNoCachePriceMicros)
    || !isNullableCount(value.cacheReadInputPriceMicros)
    || !isNullableCount(value.cacheWriteInputPriceMicros)
    || !isNullableCount(value.outputTextPriceMicros)
    || !isNullableCount(value.reasoningOutputPriceMicros)
    || !isTimestamp(value.effectiveFrom)
    || (value.effectiveTo !== null && !isTimestamp(value.effectiveTo))
    || (typeof value.effectiveTo === "number" && value.effectiveTo <= value.effectiveFrom)
    || !isBoundedText(value.approver, 160)
    || !isBoundedText(value.provenance, 320)
    || !isTimestamp(value.createdAt)
    || value.createdAt > value.effectiveFrom
  ) return undefined;
  const catalog = value as unknown as ProviderPriceCatalogInputV1;
  if (!priceFields(catalog).some((price) => price !== null)) return undefined;
  return { ...catalog };
}

export function decodeProviderCostEvidenceInput(value: unknown): ProviderCostEvidenceInputV1 | undefined {
  if (!isExactRecord(value, COST_KEYS)) return undefined;
  if (
    value.version !== 1
    || !isBoundedId(value.eventId)
    || typeof value.attemptId !== "string"
    || !OPAQUE_ATTEMPT_ID.test(value.attemptId)
    || !isCostKind(value.kind)
    || !isCostEvidenceClass(value.evidenceClass)
    || typeof value.currency !== "string"
    || !CURRENCY.test(value.currency)
    || !isSignedSafeInteger(value.amountMicros)
    || (value.supersedesEventId !== null && !isBoundedId(value.supersedesEventId))
    || (value.sourceEvidenceId !== null && !isBoundedId(value.sourceEvidenceId))
    || !isTimestamp(value.observedAt)
  ) return undefined;
  const normalized = value as unknown as ProviderCostEvidenceInputV1;
  if (
    (normalized.kind === "calculated" && (
      normalized.amountMicros < 0
      || normalized.evidenceClass === "corrected"
      || normalized.supersedesEventId !== null
      || normalized.sourceEvidenceId === null
    ))
    || (normalized.kind === "reversal" && (
      normalized.amountMicros > 0
      || normalized.evidenceClass !== "corrected"
      || normalized.supersedesEventId === null
      || normalized.sourceEvidenceId !== null
    ))
    || (normalized.kind === "replacement" && (
      normalized.amountMicros < 0
      || normalized.evidenceClass !== "corrected"
      || normalized.supersedesEventId === null
      || normalized.sourceEvidenceId !== null
    ))
    || (normalized.kind === "correction" && (
      normalized.evidenceClass !== "corrected"
      ||
      normalized.supersedesEventId === null
      || normalized.sourceEvidenceId !== null
    ))
  ) return undefined;
  return { ...normalized };
}

export function decodeProviderReconciliationImportInput(
  value: unknown,
): ProviderReconciliationImportInputV1 | undefined {
  if (!isExactRecord(value, RECONCILIATION_KEYS)) return undefined;
  if (
    value.version !== 1
    || typeof value.fingerprint !== "string"
    || !FINGERPRINT.test(value.fingerprint)
    || !isBoundedId(value.providerId)
    || typeof value.accountFingerprint !== "string"
    || !ACCOUNT_FINGERPRINT.test(value.accountFingerprint)
    || !isTimestamp(value.periodStart)
    || !isTimestamp(value.periodEnd)
    || value.periodEnd <= value.periodStart
    || typeof value.currency !== "string"
    || !CURRENCY.test(value.currency)
    || !isNonNegativeSafeInteger(value.reportedTotalMicros)
    || !isNonNegativeSafeInteger(value.matchedTotalMicros)
    || value.matchedTotalMicros > value.reportedTotalMicros
    || !isReconciliationStatus(value.status)
    || !isTimestamp(value.importedAt)
  ) return undefined;
  return { ...(value as unknown as ProviderReconciliationImportInputV1) };
}

export function calculateProviderCostMicros(
  usage: ProviderTokenUsageV1,
  catalog: ProviderPriceCatalogInputV1,
): { amountMicros: number; complete: boolean } {
  const prices = {
    inputNoCacheTokens: catalog.inputNoCachePriceMicros,
    cacheReadInputTokens: catalog.cacheReadInputPriceMicros,
    cacheWriteInputTokens: catalog.cacheWriteInputPriceMicros,
    outputTextTokens: catalog.outputTextPriceMicros,
    reasoningOutputTokens: catalog.reasoningOutputPriceMicros,
  } satisfies Record<ProviderUsageTokenField, number | null>;
  let amount = 0n;
  let complete = true;
  for (const field of PROVIDER_USAGE_TOKEN_FIELDS) {
    const tokens = usage[field];
    const price = prices[field];
    if (tokens === null) {
      complete = false;
      continue;
    }
    if (tokens === 0) continue;
    if (price === null) {
      complete = false;
      continue;
    }
    amount += (BigInt(tokens) * BigInt(price) + 500_000n) / 1_000_000n;
  }
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("provider_cost_overflow");
  return { amountMicros: Number(amount), complete };
}

export function sameProviderTokenUsage(left: ProviderTokenUsageV1, right: ProviderTokenUsageV1): boolean {
  return PROVIDER_USAGE_TOKEN_FIELDS.every((field) => left[field] === right[field]);
}

function tokenUsageFromRecord(value: Record<ProviderUsageTokenField, unknown>): ProviderTokenUsageV1 {
  return {
    inputNoCacheTokens: value.inputNoCacheTokens as number | null,
    cacheReadInputTokens: value.cacheReadInputTokens as number | null,
    cacheWriteInputTokens: value.cacheWriteInputTokens as number | null,
    outputTextTokens: value.outputTextTokens as number | null,
    reasoningOutputTokens: value.reasoningOutputTokens as number | null,
  };
}

function priceFields(value: ProviderPriceCatalogInputV1): Array<number | null> {
  return [
    value.inputNoCachePriceMicros,
    value.cacheReadInputPriceMicros,
    value.cacheWriteInputPriceMicros,
    value.outputTextPriceMicros,
    value.reasoningOutputPriceMicros,
  ];
}

function isUsageSource(value: unknown): value is ProviderUsageEvidenceSource {
  return value === "ai_sdk_generate"
    || value === "ai_sdk_stream_finish"
    || value === "openai_sse"
    || value === "anthropic_sse"
    || value === "provider_tool"
    || value === "reconciliation";
}

function isCostKind(value: unknown): value is ProviderCostEvidenceKind {
  return value === "calculated" || value === "reversal" || value === "replacement" || value === "correction";
}

function isCostEvidenceClass(value: unknown): value is ProviderCostEvidenceClass {
  return value === "estimated" || value === "reported" || value === "reconciled" || value === "corrected";
}

function isReconciliationStatus(value: unknown): value is ProviderReconciliationStatus {
  return value === "matched" || value === "partial" || value === "disputed" || value === "corrected" || value === "closed";
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_ID.test(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || isNonNegativeSafeInteger(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSignedSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => (keys as readonly string[]).includes(key));
}
