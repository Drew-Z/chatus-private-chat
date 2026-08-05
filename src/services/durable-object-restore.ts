import { stableJson } from "./instance-capture";
import type { DurableObjectCaptureSnapshotV1 } from "./durable-object-capture";

const MAX_TABLES = 256;
const MAX_ROWS_PER_TABLE = 250_000;
const MAX_STORAGE_VALUES = 250_000;
const MAX_STRUCTURED_DEPTH = 128;

export type DurableObjectRestoreSnapshotV1 = Omit<DurableObjectCaptureSnapshotV1, "tables" | "storage"> & {
  tables: Array<{
    name: string;
    schema: string;
    rows: Array<Record<string, unknown>>;
  }>;
  storage: Array<{ key: string; value: unknown }>;
};

export class DurableObjectRestoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DurableObjectRestoreError";
  }
}

export function decodeDurableObjectCaptureSnapshot(
  bytes: Uint8Array,
  expectedSchemaVersion: string,
): DurableObjectRestoreSnapshotV1 {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new DurableObjectRestoreError("restore_do_snapshot_invalid");
  }
  if (stableJson(value) !== text) {
    throw new DurableObjectRestoreError("restore_do_snapshot_noncanonical");
  }
  const snapshot = parseDurableObjectCaptureSnapshot(value, expectedSchemaVersion);
  if (!snapshot) throw new DurableObjectRestoreError("restore_do_snapshot_invalid");
  return snapshot;
}

export function decodeDurableObjectCaptureValue(value: unknown): unknown {
  return decodeStructuredValue(value, 0);
}

function parseDurableObjectCaptureSnapshot(
  value: unknown,
  expectedSchemaVersion: string,
): DurableObjectRestoreSnapshotV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "schemaVersion", "tables", "storage", "storageBackedTables", "excludedTables",
  ])) return undefined;
  if (
    value.version !== 1
    || value.schemaVersion !== expectedSchemaVersion
    || !isBoundedId(value.schemaVersion, 120)
    || !Array.isArray(value.tables)
    || value.tables.length > MAX_TABLES
    || !Array.isArray(value.storage)
    || value.storage.length > MAX_STORAGE_VALUES
    || !Array.isArray(value.storageBackedTables)
    || value.storageBackedTables.length > 1
    || !Array.isArray(value.excludedTables)
    || value.excludedTables.length > MAX_TABLES
  ) return undefined;

  const tables: DurableObjectRestoreSnapshotV1["tables"] = [];
  for (const rawTable of value.tables) {
    if (!isRecord(rawTable) || !hasExactKeys(rawTable, ["name", "schema", "rows"])) return undefined;
    if (
      !isSqlName(rawTable.name)
      || typeof rawTable.schema !== "string"
      || !rawTable.schema
      || rawTable.schema.length > 1_000_000
      || !Array.isArray(rawTable.rows)
      || rawTable.rows.length > MAX_ROWS_PER_TABLE
    ) return undefined;
    const rows: Array<Record<string, unknown>> = [];
    for (const rawRow of rawTable.rows) {
      if (!isRecord(rawRow)) return undefined;
      const decoded = decodeStructuredValue(rawRow, 0);
      if (!isRecord(decoded)) return undefined;
      rows.push(decoded);
    }
    tables.push({ name: rawTable.name, schema: rawTable.schema, rows });
  }
  if (!isStrictlySorted(tables.map(({ name }) => name))) return undefined;

  const storage: Array<{ key: string; value: unknown }> = [];
  for (const rawStorage of value.storage) {
    if (!isRecord(rawStorage) || !hasExactKeys(rawStorage, ["key", "value"])) return undefined;
    if (typeof rawStorage.key !== "string" || !rawStorage.key || rawStorage.key.length > 2_048) return undefined;
    storage.push({ key: rawStorage.key, value: decodeStructuredValue(rawStorage.value, 0) });
  }
  if (!isStrictlySorted(storage.map(({ key }) => key))) return undefined;

  const storageBackedTables: DurableObjectRestoreSnapshotV1["storageBackedTables"] = [];
  for (const rawTable of value.storageBackedTables) {
    if (
      !isRecord(rawTable)
      || !hasExactKeys(rawTable, ["name", "behavior"])
      || rawTable.name !== "_cf_KV"
      || rawTable.behavior !== "captured_via_do_storage"
    ) return undefined;
    storageBackedTables.push({ name: "_cf_KV", behavior: "captured_via_do_storage" });
  }

  const excludedTables: DurableObjectRestoreSnapshotV1["excludedTables"] = [];
  for (const rawTable of value.excludedTables) {
    if (
      !isRecord(rawTable)
      || !hasExactKeys(rawTable, ["name", "reason"])
      || typeof rawTable.name !== "string"
      || !rawTable.name.startsWith("sqlite_")
      || rawTable.reason !== "sqlite_internal_rebuilt"
    ) return undefined;
    excludedTables.push({ name: rawTable.name, reason: "sqlite_internal_rebuilt" });
  }
  if (!isStrictlySorted(excludedTables.map(({ name }) => name))) return undefined;

  return {
    version: 1,
    schemaVersion: value.schemaVersion,
    tables,
    storage,
    storageBackedTables,
    excludedTables,
  };
}

function decodeStructuredValue(value: unknown, depth: number): unknown {
  if (depth > MAX_STRUCTURED_DEPTH) throw new DurableObjectRestoreError("restore_do_value_invalid");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DurableObjectRestoreError("restore_do_value_invalid");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeStructuredValue(item, depth + 1));
  if (!isRecord(value)) throw new DurableObjectRestoreError("restore_do_value_invalid");

  if (hasExactKeys(value, ["$bigint"])) {
    if (typeof value.$bigint !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value.$bigint)) {
      throw new DurableObjectRestoreError("restore_do_value_invalid");
    }
    try {
      return BigInt(value.$bigint);
    } catch {
      throw new DurableObjectRestoreError("restore_do_value_invalid");
    }
  }
  if (hasExactKeys(value, ["$date"])) {
    if (typeof value.$date !== "string") throw new DurableObjectRestoreError("restore_do_value_invalid");
    const parsed = new Date(value.$date);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value.$date) {
      throw new DurableObjectRestoreError("restore_do_value_invalid");
    }
    return parsed;
  }
  if (hasExactKeys(value, ["$binary"]) || hasExactKeys(value, ["$binary", "$view"])) {
    const bytes = canonicalBase64ToBytes(value.$binary);
    if (!bytes) throw new DurableObjectRestoreError("restore_do_value_invalid");
    if (!("$view" in value)) return bytes.buffer;
    if (typeof value.$view !== "string") throw new DurableObjectRestoreError("restore_do_value_invalid");
    return restoreArrayBufferView(value.$view, bytes);
  }
  if (hasExactKeys(value, ["$map"])) {
    if (!Array.isArray(value.$map)) throw new DurableObjectRestoreError("restore_do_value_invalid");
    const output = new Map<unknown, unknown>();
    for (const rawEntry of value.$map) {
      if (!Array.isArray(rawEntry) || rawEntry.length !== 2) {
        throw new DurableObjectRestoreError("restore_do_value_invalid");
      }
      output.set(
        decodeStructuredValue(rawEntry[0], depth + 1),
        decodeStructuredValue(rawEntry[1], depth + 1),
      );
    }
    return output;
  }
  if (hasExactKeys(value, ["$set"])) {
    if (!Array.isArray(value.$set)) throw new DurableObjectRestoreError("restore_do_value_invalid");
    return new Set(value.$set.map((item) => decodeStructuredValue(item, depth + 1)));
  }

  return Object.fromEntries(Object.keys(value).map((key) => [
    key,
    decodeStructuredValue(value[key], depth + 1),
  ]));
}

function restoreArrayBufferView(name: string, bytes: Uint8Array): ArrayBufferView {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try {
    switch (name) {
      case "Int8Array": return new Int8Array(buffer);
      case "Uint8Array": return new Uint8Array(buffer);
      case "Uint8ClampedArray": return new Uint8ClampedArray(buffer);
      case "Int16Array": return new Int16Array(buffer);
      case "Uint16Array": return new Uint16Array(buffer);
      case "Int32Array": return new Int32Array(buffer);
      case "Uint32Array": return new Uint32Array(buffer);
      case "Float32Array": return new Float32Array(buffer);
      case "Float64Array": return new Float64Array(buffer);
      case "BigInt64Array": return new BigInt64Array(buffer);
      case "BigUint64Array": return new BigUint64Array(buffer);
      case "DataView": return new DataView(buffer);
      default: throw new DurableObjectRestoreError("restore_do_value_invalid");
    }
  } catch (error) {
    if (error instanceof DurableObjectRestoreError) throw error;
    throw new DurableObjectRestoreError("restore_do_value_invalid");
  }
}

function canonicalBase64ToBytes(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary) === value ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isBoundedId(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function isSqlName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
}

function isStrictlySorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}
