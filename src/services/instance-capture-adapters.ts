import {
  InstanceCaptureError,
  stableJson,
  type CaptureAdapterResult,
  type CaptureStoreAdapter,
  type CaptureReferenceV1,
  type CaptureRestoreBehavior,
  type CaptureStateClass,
  type InstanceObjectRegistrationV1,
} from "./instance-capture";
import {
  normalizeDurableObjectCaptureValue,
  type DurableObjectCaptureResultV1,
} from "./durable-object-capture";
import type { Env } from "../worker";

type KvCaptureClass = "authoritative" | "transitional" | "excluded";

type CapturedKvEntryV1 = {
  key: string;
  expiration: number;
  metadata: unknown;
  value: string;
};

type CapturedR2ObjectV1 = {
  key: string;
  version: string;
  size: number;
  etag: string;
  uploaded: string;
  httpMetadata: Record<string, unknown>;
  customMetadata: Record<string, string>;
  checksum: string;
  value: string;
};

const KV_AUTHORITATIVE_PREFIXES = [
  "config:",
  "route-secret:",
  "mcp-secret:",
  "feedback:",
  "guest-cleanup:",
] as const;

const KV_TRANSITIONAL_PREFIXES = ["chats:", "memory:", "usage:"] as const;

const KV_EXCLUDED_PREFIXES = [
  "session:",
  "admin:",
  "guest-source:",
  "route-reliability:",
  "route-provider-reliability:",
  "route-provider-skill-selection:",
] as const;

export type CaptureDurableObjectStub = {
  captureInstanceState(captureEpoch: string): Promise<DurableObjectCaptureResultV1>;
};

export type CaptureDocumentIngestStub = {
  captureDocumentIngestEvidence(captureEpoch: string): Promise<DurableObjectCaptureResultV1>;
};

export function createDurableObjectCaptureAdapter(input: {
  store: string;
  sourceIdentity: string;
  stub: CaptureDurableObjectStub;
  stateClass: CaptureStateClass;
  restoreBehavior: CaptureRestoreBehavior;
  expectedSchemaVersion?: string;
  references?: CaptureReferenceV1[];
}): CaptureStoreAdapter {
  return {
    store: input.store,
    async capture(captureEpoch) {
      const snapshot = await input.stub.captureInstanceState(captureEpoch);
      if (input.expectedSchemaVersion && snapshot.schemaVersion !== input.expectedSchemaVersion) {
        throw new InstanceCaptureError("capture_do_schema_mismatch");
      }
      return {
        captureEpoch,
        sourceIdentity: input.sourceIdentity,
        schemaVersion: snapshot.schemaVersion,
        generation: captureEpoch,
        stateClass: input.stateClass,
        restoreBehavior: input.restoreBehavior,
        itemCount: snapshot.itemCount,
        bytes: snapshot.bytes,
        unresolvedReferences: 0,
        references: input.references || [],
      };
    },
  };
}

export function createDocumentIngestCaptureAdapter(
  stub: CaptureDocumentIngestStub,
  sourceIdentity: string,
  references: CaptureReferenceV1[] = [],
): CaptureStoreAdapter {
  return {
    store: "document_ingest_queue",
    async capture(captureEpoch) {
      const evidence = await stub.captureDocumentIngestEvidence(captureEpoch);
      return {
        captureEpoch,
        sourceIdentity,
        schemaVersion: evidence.schemaVersion,
        generation: captureEpoch,
        stateClass: "transitional",
        restoreBehavior: "rebuild",
        itemCount: evidence.itemCount,
        bytes: evidence.bytes,
        unresolvedReferences: 0,
        references,
      };
    },
  };
}

export async function createRegisteredDurableObjectCaptureAdapters(
  env: Pick<Env, "INSTANCE_COORDINATOR" | "USER_STATE" | "TEAM_AGENT" | "PROVIDER_COORDINATOR">,
  coordinatorName: string,
): Promise<CaptureStoreAdapter[]> {
  const registry = await env.INSTANCE_COORDINATOR.getByName(coordinatorName).listRegisteredObjects();
  if (!registry.ok) throw new InstanceCaptureError(registry.error);
  if (!registry.baselineComplete) throw new InstanceCaptureError("capture_object_registry_incomplete");
  const assertRegistryUnchanged = async () => {
    const current = await env.INSTANCE_COORDINATOR.getByName(coordinatorName).listRegisteredObjects();
    if (!current.ok) throw new InstanceCaptureError(current.error);
    if (!current.baselineComplete || current.registryDigest !== registry.registryDigest) {
      throw new InstanceCaptureError("capture_object_registry_changed");
    }
  };

  const adapters: CaptureStoreAdapter[] = [{
    store: "instance_object_registry",
    capture: async (captureEpoch) => {
      await assertRegistryUnchanged();
      return {
        captureEpoch,
        sourceIdentity: `instance-registry:${coordinatorName}`,
        schemaVersion: "instance-object-registry-v1",
        generation: captureEpoch,
        stateClass: "authoritative",
        restoreBehavior: "restore",
        itemCount: registry.objects.length,
        bytes: encodeStableJson({
          version: 1,
          baselineComplete: true,
          baselineConfirmedAt: registry.baselineConfirmedAt,
          baselineInventoryId: registry.baselineInventoryId,
          registryDigest: registry.registryDigest,
          objects: registry.objects,
        }),
        unresolvedReferences: 0,
        references: [],
      };
    },
  }, {
    store: "instance_coordinator_runtime",
    capture: async (captureEpoch) => ({
      captureEpoch,
      sourceIdentity: `instance-coordinator:${coordinatorName}`,
      schemaVersion: "instance-coordinator-runtime-v1",
      generation: captureEpoch,
      stateClass: "excluded",
      restoreBehavior: "exclude",
      itemCount: 1,
      exclusionReason: "maintenance_and_operation_fences_rebuilt_empty",
      unresolvedReferences: 0,
      references: [],
    }),
  }];
  for (const object of registry.objects) {
    const sourceIdentity = objectSourceIdentity(object);
    const references = object.kind === "conversation_team_agent"
      ? [{
          targetStore: "root_team_agent",
          targetSourceIdentity: objectSourceIdentity({
            kind: "root_team_agent",
            instanceName: object.rootInstanceName,
          }),
          expectedGeneration: "",
        }]
      : [];
    const stub = object.kind === "user_state"
      ? env.USER_STATE.getByName(object.instanceName)
      : object.kind === "provider_coordinator"
        ? env.PROVIDER_COORDINATOR.getByName(object.instanceName)
        : env.TEAM_AGENT.getByName(object.instanceName);
    adapters.push(createRegistryObjectAdapter(
      object,
      stub as unknown as CaptureDurableObjectStub,
      sourceIdentity,
      references,
    ));
    if (object.kind === "root_team_agent") {
      adapters.push(createRegistryDocumentIngestAdapter(
        stub as unknown as CaptureDocumentIngestStub,
        object,
      ));
    }
  }
  for (const [kind, store] of [
    ["user_state", "user_state"],
    ["root_team_agent", "root_team_agent"],
    ["conversation_team_agent", "conversation_team_agent"],
    ["provider_coordinator", "provider_coordinator"],
  ] as const) {
    if (!registry.objects.some((object) => object.kind === kind)) {
      adapters.push(emptyInventoryAdapter(store, `instance-registry:empty:${kind}`));
    }
  }
  if (!registry.objects.some((object) => object.kind === "root_team_agent")) {
    adapters.push(emptyInventoryAdapter("document_ingest_queue", "instance-registry:empty:document-ingest"));
  }
  return adapters;
}

function createRegistryObjectAdapter(
  object: InstanceObjectRegistrationV1,
  stub: CaptureDurableObjectStub,
  sourceIdentity: string,
  referenceTemplates: CaptureReferenceV1[],
): CaptureStoreAdapter {
  return {
    store: object.kind,
    async capture(captureEpoch) {
      const snapshot = await stub.captureInstanceState(captureEpoch);
      if (snapshot.schemaVersion !== object.schemaVersion) {
        throw new InstanceCaptureError("capture_do_schema_mismatch");
      }
      return {
        captureEpoch,
        sourceIdentity,
        schemaVersion: snapshot.schemaVersion,
        generation: captureEpoch,
        stateClass: object.stateClass,
        restoreBehavior: object.restoreBehavior,
        itemCount: snapshot.itemCount,
        bytes: snapshot.bytes,
        unresolvedReferences: 0,
        references: referenceTemplates.map((reference) => ({
          ...reference,
          expectedGeneration: captureEpoch,
        })),
      };
    },
  };
}

function createRegistryDocumentIngestAdapter(
  stub: CaptureDocumentIngestStub,
  object: InstanceObjectRegistrationV1,
): CaptureStoreAdapter {
  return {
    store: "document_ingest_queue",
    async capture(captureEpoch) {
      const evidence = await stub.captureDocumentIngestEvidence(captureEpoch);
      return {
        captureEpoch,
        sourceIdentity: `document-ingest:${object.instanceName}`,
        schemaVersion: evidence.schemaVersion,
        generation: captureEpoch,
        stateClass: "transitional",
        restoreBehavior: "rebuild",
        itemCount: evidence.itemCount,
        bytes: evidence.bytes,
        unresolvedReferences: 0,
        references: [{
          targetStore: "root_team_agent",
          targetSourceIdentity: objectSourceIdentity(object),
          expectedGeneration: captureEpoch,
        }],
      };
    },
  };
}

function emptyInventoryAdapter(store: string, sourceIdentity: string): CaptureStoreAdapter {
  const rebuildable = store === "document_ingest_queue" || store === "provider_coordinator";
  return {
    store,
    capture: async (captureEpoch) => ({
      captureEpoch,
      sourceIdentity,
      schemaVersion: "empty-inventory-v1",
      generation: captureEpoch,
      stateClass: store === "document_ingest_queue" ? "transitional" : rebuildable ? "rebuildable" : "authoritative",
      restoreBehavior: rebuildable ? "rebuild" : "restore",
      itemCount: 0,
      bytes: encodeStableJson([]),
      unresolvedReferences: 0,
      references: [],
    }),
  };
}

function objectSourceIdentity(object: Pick<InstanceObjectRegistrationV1, "kind" | "instanceName">): string {
  return `do:${object.kind}:${object.instanceName}`;
}

export function createChatStoreCaptureAdapters(
  store: KVNamespace,
  sourceIdentity: string,
): CaptureStoreAdapter[] {
  const captures = new Map<string, Promise<Map<KvCaptureClass, CapturedKvEntryV1[]>>>();
  const inventory = (captureEpoch: string) => {
    let current = captures.get(captureEpoch);
    if (!current) {
      current = captureKvInventory(store);
      captures.set(captureEpoch, current);
    }
    return current;
  };
  return [
    kvAdapter("chat_store", `${sourceIdentity}:durable`, "authoritative", "restore", inventory),
    kvAdapter("chat_store_transitional", `${sourceIdentity}:transitional`, "transitional", "restore", inventory),
    {
      store: "chat_store_excluded",
      async capture(captureEpoch) {
        const entries = (await inventory(captureEpoch)).get("excluded") || [];
        return {
          captureEpoch,
          sourceIdentity: `${sourceIdentity}:excluded`,
          schemaVersion: "kv-explicit-exclusions-v1",
          generation: captureEpoch,
          stateClass: "excluded",
          restoreBehavior: "exclude",
          exclusionReason: "ephemeral_rebuild_empty",
          itemCount: entries.length,
          unresolvedReferences: 0,
          references: [],
        };
      },
    },
  ];
}

export function createWorkspaceFilesCaptureAdapter(
  bucket: R2Bucket,
  sourceIdentity: string,
): CaptureStoreAdapter {
  return {
    store: "workspace_files",
    async capture(captureEpoch) {
      const objects = await captureR2Inventory(bucket);
      return {
        captureEpoch,
        sourceIdentity,
        schemaVersion: "r2-object-envelope-v1",
        generation: captureEpoch,
        stateClass: "authoritative",
        restoreBehavior: "restore",
        itemCount: objects.length,
        bytes: encodeStableJson(objects),
        unresolvedReferences: 0,
        references: [],
      };
    },
  };
}

function kvAdapter(
  store: string,
  sourceIdentity: string,
  stateClass: "authoritative" | "transitional",
  restoreBehavior: "restore",
  inventory: (captureEpoch: string) => Promise<Map<KvCaptureClass, CapturedKvEntryV1[]>>,
): CaptureStoreAdapter {
  return {
    store,
    async capture(captureEpoch): Promise<CaptureAdapterResult> {
      const entries = (await inventory(captureEpoch)).get(stateClass) || [];
      return {
        captureEpoch,
        sourceIdentity,
        schemaVersion: "kv-entry-envelope-v1",
        generation: captureEpoch,
        stateClass,
        restoreBehavior,
        itemCount: entries.length,
        bytes: encodeStableJson(entries),
        unresolvedReferences: 0,
        references: [],
      };
    },
  };
}

async function captureKvInventory(store: KVNamespace): Promise<Map<KvCaptureClass, CapturedKvEntryV1[]>> {
  const output = new Map<KvCaptureClass, CapturedKvEntryV1[]>([
    ["authoritative", []],
    ["transitional", []],
    ["excluded", []],
  ]);
  let cursor: string | undefined;
  do {
    const page = await store.list({ cursor, limit: 1_000 });
    const values = await Promise.all(page.keys.map(async (key): Promise<{
      classification: KvCaptureClass;
      entry: CapturedKvEntryV1;
    }> => {
      const classification = classifyKvKey(key.name);
      if (!classification) throw new InstanceCaptureError("capture_kv_key_unknown");
      if (classification === "excluded") {
        return {
          classification,
          entry: { key: key.name, expiration: key.expiration || 0, metadata: null, value: "" },
        };
      }
      const value = await store.get(key.name, "arrayBuffer");
      if (!value) throw new InstanceCaptureError("capture_kv_value_missing");
      return { classification, entry: {
          key: key.name,
          expiration: key.expiration || 0,
          metadata: normalizeDurableObjectCaptureValue(key.metadata ?? null),
          value: bytesToBase64(new Uint8Array(value)),
        } };
    }));
    for (const { classification, entry } of values) {
      output.get(classification)!.push(entry);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  for (const entries of output.values()) entries.sort((left, right) => compareStrings(left.key, right.key));
  return output;
}

function classifyKvKey(key: string): KvCaptureClass | undefined {
  if (KV_AUTHORITATIVE_PREFIXES.some((prefix) => key.startsWith(prefix))) return "authoritative";
  if (KV_TRANSITIONAL_PREFIXES.some((prefix) => key.startsWith(prefix))) return "transitional";
  if (KV_EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix))) return "excluded";
  return undefined;
}

async function captureR2Inventory(bucket: R2Bucket): Promise<CapturedR2ObjectV1[]> {
  const output: CapturedR2ObjectV1[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      cursor,
      limit: 1_000,
      include: ["httpMetadata", "customMetadata"],
    });
    for (const listed of page.objects) {
      const object = await bucket.get(listed.key);
      if (!object || object.size !== listed.size) {
        throw new InstanceCaptureError("capture_r2_object_missing");
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.byteLength !== object.size) throw new InstanceCaptureError("capture_r2_object_size_mismatch");
      output.push({
        key: object.key,
        version: object.version,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded.toISOString(),
        httpMetadata: normalizeR2HttpMetadata(object.httpMetadata),
        customMetadata: object.customMetadata || {},
        checksum: await sha256Hex(bytes),
        value: bytesToBase64(bytes),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  output.sort((left, right) => compareStrings(left.key, right.key));
  if (new Set(output.map(({ key }) => key)).size !== output.length) {
    throw new InstanceCaptureError("capture_r2_object_duplicate");
  }
  return output;
}

function normalizeR2HttpMetadata(value?: R2HTTPMetadata): Record<string, unknown> {
  if (!value) return {};
  return {
    ...(value.contentType ? { contentType: value.contentType } : {}),
    ...(value.contentLanguage ? { contentLanguage: value.contentLanguage } : {}),
    ...(value.contentDisposition ? { contentDisposition: value.contentDisposition } : {}),
    ...(value.contentEncoding ? { contentEncoding: value.contentEncoding } : {}),
    ...(value.cacheControl ? { cacheControl: value.cacheControl } : {}),
    ...(value.cacheExpiry ? { cacheExpiry: value.cacheExpiry.toISOString() } : {}),
  };
}

function encodeStableJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(stableJson(value));
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
