export type ManagedSecretNamespace = "route" | "mcp";

export type EncryptedManagedSecret = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  updatedAt: string;
};

export type ManagedSecretMetadata = {
  namespace: ManagedSecretNamespace;
  ref: string;
  source: "managed" | "worker" | "missing";
  status: "configured" | "unavailable" | "missing";
  managed: boolean;
  environmentFallback: boolean;
  updatedAt?: string;
  revision?: string;
  message?: string;
};

export type ManagedSecretStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type ManagedSecretService = {
  load(namespace: ManagedSecretNamespace, ref: string): Promise<string | null>;
  resolve(namespace: ManagedSecretNamespace, ref: string): Promise<string>;
  inspect(namespace: ManagedSecretNamespace, ref: string): Promise<ManagedSecretMetadata>;
  inspectMasterKey(): Promise<{ ready: boolean; message?: string }>;
  revision(namespace: ManagedSecretNamespace, ref: string): Promise<string>;
  write(namespace: ManagedSecretNamespace, ref: string, secret: string): Promise<void>;
  delete(namespace: ManagedSecretNamespace, ref: string): Promise<void>;
};

export type ManagedSecretDependencies = {
  store: ManagedSecretStore;
  masterKey?: string;
  bindings: Record<string, unknown>;
  fingerprint(value: string): Promise<string>;
  nowIso(): string;
};

export const MANAGED_SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MAX_MANAGED_SECRET_CHARS = 8_192;

const SECRET_PREFIXES: Record<ManagedSecretNamespace, string> = {
  route: "route-secret:",
  mcp: "mcp-secret:",
};
const SECRET_AAD_PREFIXES: Record<ManagedSecretNamespace, string> = {
  route: "chatus:route-secret:v1:",
  mcp: "chatus:mcp-secret:v1:",
};

export class ManagedSecretError extends Error {
  constructor(
    readonly code: "master_key_unavailable" | "invalid_record" | "decrypt_failed",
    message: string,
  ) {
    super(message);
    this.name = "ManagedSecretError";
  }
}

export function createManagedSecretService(
  dependencies: ManagedSecretDependencies,
): ManagedSecretService {
  const importMasterKey = async (): Promise<CryptoKey> => {
    const encoded = dependencies.masterKey?.trim() || "";
    if (!encoded) {
      throw new ManagedSecretError(
        "master_key_unavailable",
        "未配置 ROUTE_KEYS_MASTER_KEY，暂时无法保存后台线路密钥",
      );
    }

    let raw: Uint8Array;
    try {
      raw = base64ToBytes(encoded);
    } catch {
      throw new ManagedSecretError(
        "master_key_unavailable",
        "ROUTE_KEYS_MASTER_KEY 格式无效，应为 32 字节随机值的 Base64 编码",
      );
    }
    if (raw.byteLength !== 32) {
      throw new ManagedSecretError(
        "master_key_unavailable",
        "ROUTE_KEYS_MASTER_KEY 长度无效，应为 32 字节随机值的 Base64 编码",
      );
    }

    try {
      return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    } catch {
      throw new ManagedSecretError("master_key_unavailable", "ROUTE_KEYS_MASTER_KEY 无法导入");
    }
  };

  const encrypt = async (
    namespace: ManagedSecretNamespace,
    ref: string,
    secret: string,
  ): Promise<EncryptedManagedSecret> => {
    const key = await importMasterKey();
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: managedSecretAdditionalData(namespace, ref),
      },
      key,
      new TextEncoder().encode(secret),
    );
    return {
      version: 1,
      algorithm: "AES-GCM",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      updatedAt: dependencies.nowIso(),
    };
  };

  const decrypt = async (
    namespace: ManagedSecretNamespace,
    ref: string,
    record: EncryptedManagedSecret,
  ): Promise<string> => {
    const key = await importMasterKey();
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(record.iv),
          additionalData: managedSecretAdditionalData(namespace, ref),
        },
        key,
        base64ToBytes(record.ciphertext),
      );
      const secret = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext);
      if (!secret) throw new Error("empty managed secret");
      return secret;
    } catch (error) {
      if (error instanceof ManagedSecretError) throw error;
      throw new ManagedSecretError(
        "decrypt_failed",
        namespace === "route"
          ? "后台线路密钥无法解密；如主密钥已轮换，请重新录入该密钥"
          : "后台 MCP 密钥无法解密；如主密钥已轮换，请重新录入该密钥",
      );
    }
  };

  const loadStored = async (
    namespace: ManagedSecretNamespace,
    ref: string,
    raw: string,
  ): Promise<string> => decrypt(namespace, ref, parseEncryptedSecret(raw, namespace));

  return {
    load: async (namespace, ref) => {
      const raw = await dependencies.store.get(managedSecretKey(namespace, ref));
      if (raw === null) return null;
      return loadStored(namespace, ref, raw);
    },
    resolve: async (namespace, ref) => {
      const raw = await dependencies.store.get(managedSecretKey(namespace, ref));
      if (raw !== null) return loadStored(namespace, ref, raw);
      return workerSecret(dependencies.bindings, ref);
    },
    inspect: async (namespace, ref) => {
      const raw = await dependencies.store.get(managedSecretKey(namespace, ref));
      const environmentFallback = Boolean(workerSecret(dependencies.bindings, ref));
      if (raw === null) {
        return {
          namespace,
          ref,
          source: environmentFallback ? "worker" : "missing",
          status: environmentFallback ? "configured" : "missing",
          managed: false,
          environmentFallback,
        };
      }

      const revision = await dependencies.fingerprint(raw);
      try {
        const record = parseEncryptedSecret(raw, namespace);
        await decrypt(namespace, ref, record);
        return {
          namespace,
          ref,
          source: "managed",
          status: "configured",
          managed: true,
          environmentFallback,
          updatedAt: record.updatedAt,
          revision,
        };
      } catch (error) {
        return {
          namespace,
          ref,
          source: "managed",
          status: "unavailable",
          managed: true,
          environmentFallback,
          revision,
          message: error instanceof ManagedSecretError
            ? error.message
            : namespace === "route" ? "后台线路密钥不可用" : "后台 MCP 密钥不可用",
        };
      }
    },
    inspectMasterKey: async () => {
      try {
        await importMasterKey();
        return { ready: true };
      } catch (error) {
        return {
          ready: false,
          message: error instanceof ManagedSecretError ? error.message : "线路密钥主密钥不可用",
        };
      }
    },
    revision: async (namespace, ref) => {
      const raw = await dependencies.store.get(managedSecretKey(namespace, ref));
      return raw === null ? "" : dependencies.fingerprint(raw);
    },
    write: async (namespace, ref, secret) => {
      const record = await encrypt(namespace, ref, secret);
      await dependencies.store.put(managedSecretKey(namespace, ref), JSON.stringify(record));
    },
    delete: (namespace, ref) => dependencies.store.delete(managedSecretKey(namespace, ref)),
  };
}

export function managedSecretPrefix(namespace: ManagedSecretNamespace): string {
  return SECRET_PREFIXES[namespace];
}

export function managedSecretKey(namespace: ManagedSecretNamespace, ref: string): string {
  return `${managedSecretPrefix(namespace)}${encodeURIComponent(ref)}`;
}

function parseEncryptedSecret(
  raw: string,
  namespace: ManagedSecretNamespace,
): EncryptedManagedSecret {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== 1
      || parsed.algorithm !== "AES-GCM"
      || typeof parsed.iv !== "string"
      || typeof parsed.ciphertext !== "string"
      || typeof parsed.updatedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.updatedAt))
      || base64ToBytes(parsed.iv).byteLength !== 12
      || base64ToBytes(parsed.ciphertext).byteLength < 16
    ) {
      throw new Error("invalid encrypted secret");
    }
    return parsed as EncryptedManagedSecret;
  } catch {
    throw new ManagedSecretError(
      "invalid_record",
      namespace === "route"
        ? "后台线路密钥记录损坏，请删除后重新录入"
        : "后台 MCP 密钥记录损坏，请删除后重新录入",
    );
  }
}

function managedSecretAdditionalData(namespace: ManagedSecretNamespace, ref: string): Uint8Array {
  return new TextEncoder().encode(`${SECRET_AAD_PREFIXES[namespace]}${ref}`);
}

function workerSecret(bindings: Record<string, unknown>, ref: string): string {
  return typeof bindings[ref] === "string" ? String(bindings[ref]).trim() : "";
}

function base64ToBytes(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("invalid base64");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
