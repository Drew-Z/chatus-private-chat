import { describe, expect, it } from "vitest";
import serviceWorkerSource from "../public/sw.js?raw";

const ORIGIN = "https://chatus.test";
const CACHE_NAME = "chatus-shell-v7";
const REACT_ASSET = "/react-chat/assets/index-12345678.js";
const LEGACY_SHELL_ASSETS = [
  "/legacy/",
  "/styles.css",
  "/app.js",
  "/markdown.js",
  "/theme.js",
  "/icons.svg",
];

type WorkerRequest = Request | {
  method: string;
  mode: string;
  url: string;
};

type FetchCall = {
  headers: Headers;
  method: string;
  pathname: string;
};

type NetworkHandler = (request: Request) => Promise<Response>;

class MemoryCache {
  private readonly entries = new Map<string, Response>();

  constructor(private readonly fetchNetwork: NetworkHandler) {}

  async addAll(requests: string[]): Promise<void> {
    await Promise.all(requests.map(async (request) => {
      const response = await this.fetchNetwork(toRequest(request));
      if (!response.ok) throw new Error(`cache_add_failed:${request}`);
      await this.put(request, response);
    }));
  }

  async match(request: Request | string): Promise<Response | undefined> {
    return this.entries.get(cacheKey(request))?.clone();
  }

  async put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(cacheKey(request), response.clone());
  }

  keys(): string[] {
    return [...this.entries.keys()].sort();
  }
}

class MemoryCacheStorage {
  private readonly stores = new Map<string, MemoryCache>();

  constructor(private readonly fetchNetwork: NetworkHandler) {}

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async match(request: Request | string): Promise<Response | undefined> {
    for (const cache of this.stores.values()) {
      const response = await cache.match(request);
      if (response) return response;
    }
    return undefined;
  }

  async open(name: string): Promise<MemoryCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new MemoryCache(this.fetchNetwork);
      this.stores.set(name, cache);
    }
    return cache;
  }
}

class ServiceWorkerHarness {
  readonly cacheStorage: MemoryCacheStorage;
  readonly fetchCalls: FetchCall[] = [];
  readonly claimedClients: string[] = [];
  readonly skippedWaiting: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  private networkHandler: NetworkHandler = async (request) => basicResponse(`network:${new URL(request.url).pathname}`);

  constructor() {
    const fetchNetwork: NetworkHandler = async (request) => {
      this.fetchCalls.push({
        headers: new Headers(request.headers),
        method: request.method,
        pathname: new URL(request.url).pathname,
      });
      return this.networkHandler(request);
    };
    this.cacheStorage = new MemoryCacheStorage(fetchNetwork);
    const self = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      },
      clients: {
        claim: () => {
          this.claimedClients.push("claimed");
          return Promise.resolve();
        },
      },
      location: { origin: ORIGIN },
      skipWaiting: () => {
        this.skippedWaiting.push("skipped");
        return Promise.resolve();
      },
    };
    const executeServiceWorker = new Function(
      "self",
      "caches",
      "fetch",
      "URL",
      `"use strict";\n${serviceWorkerSource}`,
    );
    executeServiceWorker(
      self,
      this.cacheStorage,
      (input: Request | string, init?: RequestInit) => fetchNetwork(toRequest(input, init)),
      URL,
    );
  }

  async activate(): Promise<void> {
    await this.dispatchExtendable("activate");
  }

  async fetch(request: WorkerRequest): Promise<Response | undefined> {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      request,
      respondWith: (value: Promise<Response> | Response) => {
        response = Promise.resolve(value);
      },
      waitUntil: (value: Promise<unknown>) => waits.push(Promise.resolve(value)),
    };
    this.dispatch("fetch", event);
    const resolved = await response;
    await Promise.all(waits);
    return resolved;
  }

  async install(): Promise<void> {
    await this.dispatchExtendable("install");
  }

  message(data: unknown): void {
    this.dispatch("message", { data });
  }

  setNetworkHandler(handler: NetworkHandler): void {
    this.networkHandler = handler;
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  private async dispatchExtendable(type: string): Promise<void> {
    const waits: Promise<unknown>[] = [];
    this.dispatch(type, {
      waitUntil: (value: Promise<unknown>) => waits.push(Promise.resolve(value)),
    });
    await Promise.all(waits);
  }
}

describe("service worker shell isolation", () => {
  it("precaches React and legacy shells with an explicit legacy caller marker", async () => {
    const harness = new ServiceWorkerHarness();
    harness.setNetworkHandler(async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/react-chat/") {
        return basicResponse(`<script src="${REACT_ASSET}"></script>`);
      }
      return basicResponse(`asset:${pathname}`);
    });

    await harness.install();

    const cache = await harness.cacheStorage.open(CACHE_NAME);
    expect(cache.keys()).toEqual([
      "/",
      "/app.js",
      "/icon-192.png",
      "/icon-512.png",
      "/icons.svg",
      "/legacy/",
      "/manifest.webmanifest",
      "/markdown.js",
      "/pwa.js",
      REACT_ASSET,
      "/react-chat/",
      "/styles.css",
      "/theme.js",
    ].map((path) => `${ORIGIN}${path}`).sort());
    expect(harness.fetchCalls
      .filter((call) => call.headers.get("x-chatus-legacy-caller") === "service_worker")
      .map((call) => call.pathname)
      .sort()).toEqual([...LEGACY_SHELL_ASSETS].sort());
    expect(harness.fetchCalls
      .filter((call) => !LEGACY_SHELL_ASSETS.includes(call.pathname))
      .every((call) => !call.headers.has("x-chatus-legacy-caller"))).toBe(true);
  });

  it.each([
    ["/legacy/bookmark", "/legacy/", "legacy-shell", 404],
    ["/react-chat/thread", "/react-chat/", "react-shell", 503],
    ["/settings", "/", "root-shell", 500],
  ])("uses only the matching navigation shell for %s", async (pathname, cachePath, expected, status) => {
    const harness = new ServiceWorkerHarness();
    const cache = await harness.cacheStorage.open(CACHE_NAME);
    await cache.put("/", basicResponse("root-shell"));
    await cache.put("/react-chat/", basicResponse("react-shell"));
    await cache.put("/legacy/", basicResponse("legacy-shell"));
    harness.setNetworkHandler(async () => basicResponse("network-error", status));

    const response = await harness.fetch(navigationRequest(pathname));

    expect(await response?.text()).toBe(expected);
    expect(await cache.match(cachePath).then((value) => value?.text())).toBe(expected);
  });

  it("uses the matching cached shell offline without crossing shell boundaries", async () => {
    const harness = new ServiceWorkerHarness();
    const cache = await harness.cacheStorage.open(CACHE_NAME);
    await cache.put("/", basicResponse("root-offline"));
    await cache.put("/react-chat/", basicResponse("react-offline"));
    await cache.put("/legacy/", basicResponse("legacy-offline"));
    harness.setNetworkHandler(async () => { throw new Error("offline"); });

    const legacy = await harness.fetch(navigationRequest("/legacy/history"));
    const react = await harness.fetch(navigationRequest("/react-chat/history"));
    const root = await harness.fetch(navigationRequest("/history"));

    expect(await legacy?.text()).toBe("legacy-offline");
    expect(await react?.text()).toBe("react-offline");
    expect(await root?.text()).toBe("root-offline");
  });

  it.each([401, 403, 410])("does not hide a terminal %s navigation response with cached content", async (status) => {
    const harness = new ServiceWorkerHarness();
    const cache = await harness.cacheStorage.open(CACHE_NAME);
    await cache.put("/legacy/", basicResponse("legacy-shell"));
    harness.setNetworkHandler(async () => basicResponse(`network-${status}`, status));

    const response = await harness.fetch(navigationRequest("/legacy/private"));

    expect(response?.status).toBe(status);
    expect(await response?.text()).toBe(`network-${status}`);
  });

  it("replaces only the matching cache key after a successful navigation", async () => {
    const harness = new ServiceWorkerHarness();
    const cache = await harness.cacheStorage.open(CACHE_NAME);
    await cache.put("/", basicResponse("root-shell"));
    await cache.put("/react-chat/", basicResponse("react-shell"));
    await cache.put("/legacy/", basicResponse("legacy-shell"));
    harness.setNetworkHandler(async () => basicResponse("fresh-legacy"));

    expect(await harness.fetch(navigationRequest("/legacy/fresh")).then((response) => response?.text())).toBe("fresh-legacy");
    expect(await cache.match("/legacy/").then((response) => response?.text())).toBe("fresh-legacy");
    expect(await cache.match("/react-chat/").then((response) => response?.text())).toBe("react-shell");
    expect(await cache.match("/").then((response) => response?.text())).toBe("root-shell");
  });

  it("runtime-caches a fingerprinted React chunk and serves it offline", async () => {
    const harness = new ServiceWorkerHarness();
    const request: WorkerRequest = { method: "GET", mode: "cors", url: `${ORIGIN}/react-chat/assets/ChatWorkspace-abcdef12.js` };
    harness.setNetworkHandler(async () => basicResponse("member-workspace-chunk"));

    expect(await harness.fetch(request).then((response) => response?.text())).toBe("member-workspace-chunk");
    expect(harness.fetchCalls.map((call) => call.pathname)).toEqual(["/react-chat/assets/ChatWorkspace-abcdef12.js"]);

    harness.setNetworkHandler(async () => { throw new Error("offline"); });
    expect(await harness.fetch(request).then((response) => response?.text())).toBe("member-workspace-chunk");
    expect(harness.fetchCalls.map((call) => call.pathname)).toEqual([
      "/react-chat/assets/ChatWorkspace-abcdef12.js",
      "/react-chat/assets/ChatWorkspace-abcdef12.js",
    ]);
  });

  it("deletes stale cache versions and claims clients on activation", async () => {
    const harness = new ServiceWorkerHarness();
    await harness.cacheStorage.open("chatus-shell-v5");
    await harness.cacheStorage.open(CACHE_NAME);

    await harness.activate();

    expect(await harness.cacheStorage.keys()).toEqual([CACHE_NAME]);
    expect(harness.claimedClients).toEqual(["claimed"]);
  });

  it("keeps API, Agent, release, non-GET, and cross-origin requests outside its fetch boundary", async () => {
    const harness = new ServiceWorkerHarness();
    const requests: WorkerRequest[] = [
      navigationRequest("/api/session"),
      navigationRequest("/agent/chat"),
      navigationRequest("/release.json"),
      { method: "POST", mode: "cors", url: `${ORIGIN}/styles.css` },
      { method: "GET", mode: "cors", url: "https://example.test/styles.css" },
    ];

    for (const request of requests) expect(await harness.fetch(request)).toBeUndefined();
    expect(harness.fetchCalls).toEqual([]);
  });

  it("skips waiting only for the explicit release-update message", () => {
    const harness = new ServiceWorkerHarness();

    harness.message({ type: "IGNORED" });
    expect(harness.skippedWaiting).toEqual([]);
    harness.message({ type: "SKIP_WAITING" });
    expect(harness.skippedWaiting).toEqual(["skipped"]);
  });
});

function basicResponse(body: string, status = 200): Response {
  const response = new Response(body, { status });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

function cacheKey(request: Request | string): string {
  return new URL(typeof request === "string" ? request : request.url, ORIGIN).toString();
}

function navigationRequest(pathname: string): WorkerRequest {
  return {
    method: "GET",
    mode: "navigate",
    url: `${ORIGIN}${pathname}`,
  };
}

function toRequest(input: Request | string, init?: RequestInit): Request {
  if (input instanceof Request) return init ? new Request(input, init) : input;
  if (typeof input === "object") {
    return new Request(input.url, {
      ...init,
      headers: input.headers,
      method: input.method,
    });
  }
  return new Request(new URL(input, ORIGIN), init);
}
