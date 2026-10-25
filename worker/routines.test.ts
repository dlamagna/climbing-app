// Starting the coach review or the issue worker from the app (#73).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./db";
import { COOLDOWN_MS, fireRoutine, isRoutineName, resetCooldowns, routinesAvailable } from "./routines";

const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_abc123/fire";
const env = {
  COACH_REVIEW_FIRE_URL: URL_OK,
  COACH_REVIEW_FIRE_TOKEN: "sk-ant-oat01-test",
} as unknown as Env;

beforeEach(() => resetCooldowns());
afterEach(() => vi.unstubAllGlobals());

describe("routinesAvailable", () => {
  it("lists only routines with a valid trigger URL and a token", () => {
    expect(routinesAvailable(env)).toEqual({ review: true, worker: false });
    expect(routinesAvailable({} as unknown as Env)).toEqual({ review: false, worker: false });
    const bad = { ...env, COACH_REVIEW_FIRE_URL: "https://example.com/v1/claude_code/routines/trig_abc/fire" } as unknown as Env;
    expect(routinesAvailable(bad).review).toBe(false);
  });

  it("knows the routine names", () => {
    expect(isRoutineName("review")).toBe(true);
    expect(isRoutineName("worker")).toBe(true);
    expect(isRoutineName("deploy")).toBe(false);
  });
});

describe("fireRoutine", () => {
  it("posts to the trigger URL with the token and returns the session link", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_1" }));
    });
    expect(await fireRoutine(env, "review", 1_000_000)).toEqual({ session_url: "https://claude.ai/code/session_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_OK);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ant-oat01-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].init.method).toBe("POST");
  });

  it("refuses a second start within the cooldown, then allows it", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ claude_code_session_url: "https://claude.ai/code/s" })));
    await fireRoutine(env, "review", 1_000_000);
    await expect(fireRoutine(env, "review", 1_000_000 + 1000)).rejects.toThrow(/less than a minute ago/);
    await expect(fireRoutine(env, "review", 1_000_000 + COOLDOWN_MS)).resolves.toBeTruthy();
  });

  it("explains failures and doesn't hold the cooldown after one", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(fireRoutine(env, "review", 1_000_000)).rejects.toThrow(/token was rejected/);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 429 }));
    await expect(fireRoutine(env, "review", 1_000_001)).rejects.toThrow(/too often this hour/);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    await expect(fireRoutine(env, "review", 1_000_002)).rejects.toThrow(/Couldn't reach Claude/);
  });

  it("says when a routine isn't set up, without calling out", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fireRoutine(env, "worker")).rejects.toThrow(/isn't set up/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
