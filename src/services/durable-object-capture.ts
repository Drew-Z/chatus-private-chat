import { InstanceCaptureError, stableJson } from "./instance-capture";

export type DurableObjectCaptureSnapshotV1 = {
  version: 1;
  schemaVersion: string;
  tables: Array<{
    name: string;
    schema: string;
    rows: Array<Record<string, unknown>>;
  }>;
  storage: Array<{ key: string; value: unknown }>;
  storageBackedTables: Array<{ name: "_cf_KV"; behavior: "captured_via_do_storage" }>;
  excludedTables: Array<{ name: string; reason: "sqlite_internal_rebuilt" }>;
};

export type DurableObjectCaptureResultV1 = {
  schemaVersion: string;
  itemCount: number;
  bytes: Uint8Array;
};

export async function captureDurableObjectState(
  storage: DurableObjectStorage,
  schemaVersion: string,
  ownsTable: (name: string) => boolean,
): Promise<DurableObjectCaptureResultV1> {
  const tableRows = storage.sql.exec<{ name: string; sql: string | null }>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).toArray();
  const tables: DurableObjectCaptureSnapshotV1["tables"] = [];
  const storageBackedTables: DurableObjectCaptureSnapshotV1["storageBackedTables"] = [];
  const excludedTables: DurableObjectCaptureSnapshotV1["excludedTables"] = [];
  for (const table of tableRows) {
    if (table.name === "_cf_KV") {
      storageBackedTables.push({ name: "_cf_KV", behavior: "captured_via_do_storage" });
      continue;
    }
    if (table.name.startsWith("sqlite_")) {
      excludedTables.push({ name: table.name, reason: "sqlite_internal_rebuilt" });
      continue;
    }
    if (!ownsTable(table.name) || !table.sql) {
      throw new InstanceCaptureError("capture_do_table_unknown");
    }
    const quoted = `"${table.name.replaceAll('"', '""')}"`;
    const rows = storage.sql.exec(`SELECT * FROM ${quoted}`)
      .toArray()
      .map((row) => normalizeDurableObjectCaptureValue(row) as Record<string, unknown>);
    rows.sort((left, right) => compareStrings(stableJson(left), stableJson(right)));
    tables.push({ name: table.name, schema: table.sql, rows });
  }
  const durableStorage = await captureDurableObjectKeyValues(storage);
  const snapshot: DurableObjectCaptureSnapshotV1 = {
    version: 1,
    schemaVersion,
    tables,
    storage: durableStorage,
    storageBackedTables,
    excludedTables,
  };
  return {
    schemaVersion,
    itemCount: tables.reduce((count, table) => count + table.rows.length, durableStorage.length),
    bytes: new TextEncoder().encode(stableJson(snapshot)),
  };
}

async function captureDurableObjectKeyValues(
  storage: DurableObjectStorage,
): Promise<Array<{ key: string; value: unknown }>> {
  const output: Array<{ key: string; value: unknown }> = [];
  let startAfter: string | undefined;
  while (true) {
    const page = await storage.list({ startAfter, limit: 1_000 });
    if (!page.size) break;
    for (const [key, value] of page) output.push({ key, value: normalizeDurableObjectCaptureValue(value) });
    const next = [...page.keys()].at(-1);
    if (!next || page.size < 1_000) break;
    startAfter = next;
  }
  output.sort((left, right) => compareStrings(left.key, right.key));
  return output;
}

export function normalizeDurableObjectCaptureValue(value: unknown): unknown {
  return normalizeStructuredValue(value, new WeakSet<object>());
}

function normalizeStructuredValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InstanceCaptureError("capture_do_value_invalid");
    return value;
  }
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new InstanceCaptureError("capture_do_value_invalid");
    return { $date: value.toISOString() };
  }
  if (value instanceof ArrayBuffer) return { $binary: bytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    return {
      $binary: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      $view: value.constructor.name,
    };
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new InstanceCaptureError("capture_do_value_invalid");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item) => normalizeStructuredValue(item, ancestors));
      }
      if (value instanceof Map) {
        const entries = [...value.entries()].map(([key, item]) => [
          normalizeStructuredValue(key, ancestors),
          normalizeStructuredValue(item, ancestors),
        ]);
        entries.sort((left, right) => compareStrings(stableJson(left), stableJson(right)));
        return { $map: entries };
      }
      if (value instanceof Set) {
        const items = [...value].map((item) => normalizeStructuredValue(item, ancestors));
        items.sort((left, right) => compareStrings(stableJson(left), stableJson(right)));
        return { $set: items };
      }
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [
        key,
        normalizeStructuredValue(record[key], ancestors),
      ]));
    } finally {
      ancestors.delete(value);
    }
  }
  throw new InstanceCaptureError("capture_do_value_invalid");
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
