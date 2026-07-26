import { describe, expect, it } from "vitest";
import {
  createManagedSecretService,
  managedSecretKey,
  ManagedSecretError,
  type ManagedSecretNamespace,
  type ManagedSecretStore,
} from "../src/services/managed-secrets";

const NOW = "2026-07-26T08:30:00.000Z";

describe("managed secret service", () => {
  it("encrypts, inspects, resolves, revisions, and deletes a managed secret", async () => {
    const store = new MemoryManagedSecretStore();
    const service = createService(store);

    await service.write("route", "ROUTE_KEY", "server-secret");

    const raw = store.values.get(managedSecretKey("route", "ROUTE_KEY"));
    expect(raw).toBeTypeOf("string");
    expect(raw).not.toContain("server-secret");
    await expect(service.load("route", "ROUTE_KEY")).resolves.toBe("server-secret");
    await expect(service.resolve("route", "ROUTE_KEY")).resolves.toBe("server-secret");
    await expect(service.revision("route", "ROUTE_KEY")).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(service.inspect("route", "ROUTE_KEY")).resolves.toMatchObject({
      namespace: "route",
      ref: "ROUTE_KEY",
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback: false,
      updatedAt: NOW,
    });

    await service.delete("route", "ROUTE_KEY");
    await expect(service.revision("route", "ROUTE_KEY")).resolves.toBe("");
    await expect(service.load("route", "ROUTE_KEY")).resolves.toBeNull();
  });

  it("uses a trimmed Worker binding only when the managed record is missing", async () => {
    const store = new MemoryManagedSecretStore();
    const service = createService(store, masterKey(1), { WORKER_KEY: "  worker-secret  " });

    await expect(service.load("mcp", "WORKER_KEY")).resolves.toBeNull();
    await expect(service.resolve("mcp", "WORKER_KEY")).resolves.toBe("worker-secret");
    await expect(service.inspect("mcp", "WORKER_KEY")).resolves.toEqual({
      namespace: "mcp",
      ref: "WORKER_KEY",
      source: "worker",
      status: "configured",
      managed: false,
      environmentFallback: true,
    });
  });

  it.each(["route", "mcp"] satisfies ManagedSecretNamespace[])(
    "does not fall back for an empty %s record",
    async (namespace) => {
      const store = new MemoryManagedSecretStore();
      store.values.set(managedSecretKey(namespace, "BROKEN_KEY"), "");
      const service = createService(store, masterKey(1), { BROKEN_KEY: "worker-secret" });

      await expect(service.resolve(namespace, "BROKEN_KEY")).rejects.toMatchObject({
        name: "ManagedSecretError",
        code: "invalid_record",
      });
      await expect(service.inspect(namespace, "BROKEN_KEY")).resolves.toMatchObject({
        namespace,
        ref: "BROKEN_KEY",
        source: "managed",
        status: "unavailable",
        managed: true,
        environmentFallback: true,
        revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    },
  );

  it("does not fall back for a malformed managed record", async () => {
    const store = new MemoryManagedSecretStore();
    store.values.set(managedSecretKey("route", "BROKEN_KEY"), "{not-json");
    const service = createService(store, masterKey(1), { BROKEN_KEY: "worker-secret" });

    await expect(service.resolve("route", "BROKEN_KEY")).rejects.toBeInstanceOf(ManagedSecretError);
    await expect(service.resolve("route", "BROKEN_KEY")).rejects.toMatchObject({ code: "invalid_record" });
  });

  it.each(["route", "mcp"] satisfies ManagedSecretNamespace[])(
    "does not fall back when a %s record cannot be decrypted",
    async (namespace) => {
      const store = new MemoryManagedSecretStore();
      await createService(store, masterKey(1)).write(namespace, "ROTATED_KEY", "managed-secret");
      const rotated = createService(store, masterKey(2), { ROTATED_KEY: "worker-secret" });

      await expect(rotated.resolve(namespace, "ROTATED_KEY")).rejects.toMatchObject({
        name: "ManagedSecretError",
        code: "decrypt_failed",
      });
      await expect(rotated.inspect(namespace, "ROTATED_KEY")).resolves.toMatchObject({
        source: "managed",
        status: "unavailable",
        managed: true,
        environmentFallback: true,
      });
    },
  );

  it("binds ciphertext to its namespace and reference", async () => {
    const store = new MemoryManagedSecretStore();
    const service = createService(store);
    await service.write("route", "SOURCE_KEY", "managed-secret");
    const raw = store.values.get(managedSecretKey("route", "SOURCE_KEY"));
    if (raw === undefined) throw new Error("missing encrypted fixture");
    store.values.set(managedSecretKey("mcp", "TARGET_KEY"), raw);

    await expect(service.resolve("mcp", "TARGET_KEY")).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("treats blank Worker bindings as missing", async () => {
    const service = createService(new MemoryManagedSecretStore(), masterKey(1), { BLANK_KEY: "   " });

    await expect(service.resolve("route", "BLANK_KEY")).resolves.toBe("");
    await expect(service.inspect("route", "BLANK_KEY")).resolves.toMatchObject({
      source: "missing",
      status: "missing",
      environmentFallback: false,
    });
  });
});

class MemoryManagedSecretStore implements ManagedSecretStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createService(
  store: ManagedSecretStore,
  encodedMasterKey = masterKey(1),
  bindings: Record<string, unknown> = {},
) {
  return createManagedSecretService({
    store,
    masterKey: encodedMasterKey,
    bindings,
    fingerprint: fingerprintText,
    nowIso: () => NOW,
  });
}

function masterKey(fill: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(fill);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function fingerprintText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
