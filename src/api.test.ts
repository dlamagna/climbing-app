// Saving writes (#82): a request that hangs times out and is queued, transient server errors are queued and
// kept for retry, and writes the server rejects on replay are reported rather than dropped silently.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, REQUEST_TIMEOUT_MS, TimeoutError, flushOutbox, isTransient, pendingCount, send } from "./api";

type Handler = (path: string, init: RequestInit) => Promise<Response>;
let handler: Handler;
const calls: { path: string; key: string | null }[] = [];

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { dispatchEvent: () => true });
  calls.length = 0;
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const path = url.replace("/api", "");
    calls.push({ path, key: new Headers(init.headers).get("Idempotency-Key") });
    return handler(path, init);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (body: unknown = { id: 1 }) => async () => Response.json(body);
const status = (code: number, error = `failed ${code}`) => async () => Response.json({ error }, { status: code });
const offline = async () => {
  throw new TypeError("Failed to fetch");
};
// Never answers, but rejects when aborted, like fetch.
const hang: Handler = (_path, init) =>
  new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

describe("isTransient", () => {
  it("is true for network errors, timeouts and gateway / unavailable answers, false for real rejections", () => {
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient(new TimeoutError("Request timed out"))).toBe(true);
    for (const s of [408, 429, 502, 503, 504]) expect(isTransient(new HttpError("x", s))).toBe(true);
    for (const s of [400, 404, 409, 500]) expect(isTransient(new HttpError("x", s))).toBe(false);
    expect(isTransient(new Error("x"))).toBe(false);
  });
});

describe("send", () => {
  it("returns the server's answer when it works", async () => {
    handler = ok({ id: 7 });
    expect(await send("POST", "/sessions", { a: 1 })).toEqual({ id: 7 });
    expect(pendingCount()).toBe(0);
  });

  it("queues the write when offline", async () => {
    handler = offline;
    expect(await send("POST", "/sessions", { a: 1 })).toEqual({ queued: true });
    expect(pendingCount()).toBe(1);
  });

  it("times out a request that never answers and queues it", async () => {
    vi.useFakeTimers();
    handler = hang;
    const result = send("POST", "/sessions", { a: 1 });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await result).toEqual({ queued: true });
    expect(pendingCount()).toBe(1);
  });

  it("queues on a transient server error, throws on a real one", async () => {
    handler = status(503);
    expect(await send("POST", "/sessions", { a: 1 })).toEqual({ queued: true });
    handler = status(400, "rpe must be 1-10");
    await expect(send("POST", "/sessions", { a: 1 })).rejects.toThrow("rpe must be 1-10");
    expect(pendingCount()).toBe(1);
  });
});

describe("flushOutbox", () => {
  it("replays with the same idempotency key, and keeps writes while the server is unavailable", async () => {
    handler = offline;
    await send("POST", "/sessions", { a: 1 }, "k1");
    await send("POST", "/checkins", { b: 2 }, "k2");
    handler = status(502);
    expect(await flushOutbox()).toEqual({ sent: 0, dropped: 0, error: null });
    expect(pendingCount()).toBe(2);
    handler = ok();
    expect(await flushOutbox()).toEqual({ sent: 2, dropped: 0, error: null });
    expect(pendingCount()).toBe(0);
    expect(calls.slice(-2)).toEqual([
      { path: "/sessions", key: "k1" },
      { path: "/checkins", key: "k2" },
    ]);
  });

  it("drops a write the server rejects, counts it apart from the sent ones and says why", async () => {
    handler = offline;
    await send("POST", "/sessions", { a: 1 }, "bad");
    await send("POST", "/sessions", { a: 2 }, "good");
    handler = async (_path, init) =>
      JSON.parse(String(init.body)).a === 1 ? Response.json({ error: "date is required" }, { status: 400 }) : Response.json({ id: 2 });
    expect(await flushOutbox()).toEqual({ sent: 1, dropped: 1, error: "date is required" });
    expect(pendingCount()).toBe(0);
  });
});
