// Runs public/sw.js against a fake service worker environment: precache on install, old caches cleaned on
// activate, and the cached shell served when the network fails or hangs (#110).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SwManifest } from "./swPrecache";

const ORIGIN = "https://climb.example";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request | string, opts?: { ignoreSearch?: boolean }) {
    const url = new URL(typeof req === "string" ? req : req.url, ORIGIN);
    if (opts?.ignoreSearch) url.search = "";
    return this.store.get(url.href)?.clone();
  }
  async put(req: Request | string, res: Response) {
    this.store.set(new URL(typeof req === "string" ? req : req.url, ORIGIN).href, res);
  }
  async addAll(reqs: Request[]) {
    const responses = await Promise.all(reqs.map((r) => fetchImpl(r)));
    if (responses.some((r) => !r.ok)) throw new TypeError("addAll failed");
    reqs.forEach((r, i) => this.store.set(new URL(r.url, ORIGIN).href, responses[i]));
  }
}

let caches: Map<string, FakeCache>;
let fetchImpl: (req: Request) => Promise<Response>;
let listeners: Record<string, (event: unknown) => void>;
let skipped: boolean;

function boot(manifest?: SwManifest) {
  listeners = {};
  skipped = false;
  const self = {
    __SW_MANIFEST: manifest,
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    skipWaiting: async () => void (skipped = true),
    clients: { claim: async () => undefined },
  };
  const cacheStorage = {
    open: async (name: string) => caches.get(name) ?? caches.set(name, new FakeCache()).get(name)!,
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };
  const RequestAt = class extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, ORIGIN).href : input, init);
    }
  };
  new Function("self", "caches", "fetch", "location", "Request", source)(
    self,
    cacheStorage,
    (req: Request) => fetchImpl(req),
    new URL(ORIGIN),
    RequestAt,
  );
}

function lifecycle(type: "install" | "activate") {
  let done: Promise<unknown> = Promise.resolve();
  listeners[type]({ waitUntil: (p: Promise<unknown>) => (done = p) });
  return done;
}

// A navigation request (Request's mode can't be set to "navigate" in Node, so it is faked).
function request(path: string, navigate = false) {
  const req = new Request(ORIGIN + path);
  if (navigate) Object.defineProperty(req, "mode", { value: "navigate" });
  return req;
}

function fetchEvent(req: Request): Promise<Response> | undefined {
  let response: Promise<Response> | undefined;
  listeners.fetch({ request: req, respondWith: (p: Promise<Response>) => (response = p), waitUntil: () => undefined });
  return response;
}

const page = (body: string) => new Response(body, { status: 200 });
const offline = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};
const hang = () => new Promise<Response>(() => undefined);

const manifest = { version: "v2", urls: ["/", "/assets/index-abc.js"] };

beforeEach(() => {
  caches = new Map();
  fetchImpl = async (req) => page(`net ${new URL(req.url).pathname}`);
});

afterEach(() => vi.useRealTimers());

describe("install", () => {
  it("precaches every file in the manifest before taking over", async () => {
    boot(manifest);
    await lifecycle("install");
    expect([...caches.keys()]).toEqual(["climb-v2"]);
    expect([...caches.get("climb-v2")!.store.keys()]).toEqual([`${ORIGIN}/`, `${ORIGIN}/assets/index-abc.js`]);
    expect(skipped).toBe(true);
  });

  it("doesn't take over when a file can't be fetched", async () => {
    boot(manifest);
    fetchImpl = async (req) => (req.url.endsWith(".js") ? new Response("", { status: 404 }) : page("ok"));
    await expect(lifecycle("install")).rejects.toThrow();
    expect(skipped).toBe(false);
  });
});

describe("activate", () => {
  it("deletes the caches of older versions and keeps unrelated ones", async () => {
    caches.set("climb-v1", new FakeCache());
    caches.set("climb-v2", new FakeCache());
    caches.set("other", new FakeCache());
    boot(manifest);
    await lifecycle("activate");
    expect([...caches.keys()].sort()).toEqual(["climb-v2", "other"]);
  });
});

describe("fetch", () => {
  beforeEach(async () => {
    boot(manifest);
    fetchImpl = async (req) => page(`cached ${new URL(req.url).pathname}`);
    await lifecycle("install");
  });

  it("serves the network answer when it comes in time", async () => {
    fetchImpl = async () => page("fresh");
    expect(await (await fetchEvent(request("/", true)))!.text()).toBe("fresh");
  });

  it("serves the cached shell for any route when offline", async () => {
    fetchImpl = offline;
    expect(await (await fetchEvent(request("/timer?x=1", true)))!.text()).toBe("cached /");
  });

  it("serves the cached shell after the timeout when the connection hangs", async () => {
    vi.useFakeTimers();
    fetchImpl = hang;
    const res = fetchEvent(request("/", true))!;
    await vi.advanceTimersByTimeAsync(3000);
    expect(await (await res).text()).toBe("cached /");
  });

  it("keeps waiting for the network when nothing is cached", async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    fetchImpl = () => new Promise<Response>((resolve) => (answer = resolve));
    const res = fetchEvent(request("/icon-192.png"))!;
    await vi.advanceTimersByTimeAsync(5000);
    answer(page("late icon"));
    expect(await (await res).text()).toBe("late icon");
  });

  it("serves hashed assets from the cache without asking the network", async () => {
    fetchImpl = vi.fn(hang);
    expect(await (await fetchEvent(request("/assets/index-abc.js")))!.text()).toBe("cached /assets/index-abc.js");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leaves API calls to the app", () => {
    expect(fetchEvent(request("/api/overview"))).toBeUndefined();
  });
});
