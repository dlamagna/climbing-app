// Starting the coach review, then the issue worker, after a logged session: the real SQL on an in-memory
// SQLite behind a minimal D1 shim, with Claude's fire endpoint stubbed. Made-up data only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_DELAY_MIN, MAX_ATTEMPTS, WORKER_FALLBACK_MIN, autoStartStatus, checkAutoStarts, startFromApp } from "./autoStart";
import type { Env } from "./db";
import { resetCooldowns } from "./routines";

type Value = string | number | null;

function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, params: Value[] = []) => ({
    sql,
    bind: (...p: Value[]) => stmt(sql, p),
    first: async () => (db.prepare(sql).get(...params) as Record<string, unknown> | undefined) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const REVIEW_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_review1/fire";
const WORKER_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_worker1/fire";

let sqlite: DatabaseSync;
let env: Env;
let fired: { url: string; text: string }[];
let status: number;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  env = {
    DB: d1(sqlite),
    COACH_REVIEW_FIRE_URL: REVIEW_URL,
    COACH_REVIEW_FIRE_TOKEN: "sk-ant-oat01-test-review",
    ISSUE_WORKER_FIRE_URL: WORKER_URL,
    ISSUE_WORKER_FIRE_TOKEN: "sk-ant-oat01-test-worker",
  } as unknown as Env;
  fired = [];
  status = 200;
  resetCooldowns();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fired.push({ url, text: JSON.parse(String(init.body)).text });
    return new Response(JSON.stringify({ claude_code_session_url: `https://claude.ai/code/session_${fired.length}` }), { status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const at = (hhmm: string) => new Date(`2026-05-10T${hhmm}:00Z`);
const logSession = (hhmm: string, type = "boulder") =>
  sqlite
    .prepare("INSERT INTO sessions (date, type, duration_min, rpe, created_at) VALUES ('2026-05-10', ?, 60, 7, ?)")
    .run(type, `2026-05-10T${hhmm}:00Z`);
const recordReview = (hhmm: string) =>
  sqlite
    .prepare("INSERT INTO coach_runs (outcome, seen_through, created_at) VALUES ('no_change', ?, ?)")
    .run(`2026-05-10T${hhmm}:00Z`, `2026-05-10T${hhmm}:00Z`);
// Each check is a separate cron run, so the in-memory double-tap guard doesn't carry over.
const check = (hhmm: string) => {
  resetCooldowns();
  return checkAutoStarts(env, at(hhmm));
};
const firedRoutines = () => fired.map((f) => (f.url === REVIEW_URL ? "review" : "worker"));

describe("checkAutoStarts", () => {
  it("does nothing without a logged session", async () => {
    expect(await check("18:00")).toEqual([]);
    expect(fired).toEqual([]);
  });

  it("starts the review 30 minutes after a session, once", async () => {
    logSession("17:00");
    expect(await check("17:25")).toEqual([]);
    const [start] = await check("17:30");
    expect(start).toMatchObject({ routine: "review", started_by: "session", status: "started", session_logged_at: "2026-05-10T17:00:00Z" });
    expect(start.session_url).toBe("https://claude.ai/code/session_1");
    expect(fired[0].text).toContain(`${AUTO_DELAY_MIN} minutes after a training session`);
    await check("17:35");
    expect(firedRoutines()).toEqual(["review"]);
  });

  it("waits for the last of sessions logged close together", async () => {
    logSession("17:00");
    logSession("17:20", "hangboard");
    expect(await check("17:30")).toEqual([]);
    await check("17:50");
    expect(firedRoutines()).toEqual(["review"]);
    expect(sqlite.prepare("SELECT session_logged_at FROM routine_starts").get()).toEqual({ session_logged_at: "2026-05-10T17:20:00Z" });
  });

  it("starts again for a session logged after the last review", async () => {
    logSession("09:00");
    await check("09:30");
    recordReview("09:33");
    await check("09:35"); // worker
    logSession("18:00");
    await check("18:30");
    expect(firedRoutines()).toEqual(["review", "worker", "review"]);
  });

  it("ignores sessions logged long ago, e.g. right after deploying", async () => {
    logSession("01:00");
    expect(await check("18:00")).toEqual([]);
  });

  it("doesn't restart for an older session once the newest one is deleted", async () => {
    logSession("17:00");
    logSession("17:10");
    await check("17:40");
    sqlite.prepare("DELETE FROM sessions WHERE created_at = '2026-05-10T17:10:00Z'").run();
    await check("17:45");
    expect(firedRoutines()).toEqual(["review"]);
  });

  it("starts the worker once the review has recorded its run", async () => {
    logSession("17:00");
    await check("17:30");
    expect(await check("17:35")).toEqual([]); // review still running
    recordReview("17:36");
    const [w] = await check("17:40");
    expect(w).toMatchObject({ routine: "worker", status: "started", session_logged_at: "2026-05-10T17:00:00Z" });
    expect(fired[1].text).toContain("after the coach review");
    await check("17:45");
    expect(firedRoutines()).toEqual(["review", "worker"]);
  });

  it("starts the worker anyway when the review never records a run", async () => {
    logSession("17:00");
    await check("17:30");
    expect(await check("18:25")).toEqual([]);
    const [w] = await check(`18:${30 + WORKER_FALLBACK_MIN - 60}`);
    expect(w.routine).toBe("worker");
  });

  it("doesn't count a review recorded before the automatic one started", async () => {
    recordReview("17:10");
    logSession("17:00");
    await check("17:30");
    expect(await check("17:35")).toEqual([]);
  });

  it("skips the worker when its trigger isn't set up", async () => {
    env = { ...env, ISSUE_WORKER_FIRE_URL: undefined } as unknown as Env;
    logSession("17:00");
    await check("17:30");
    recordReview("17:32");
    await check("17:35");
    expect(firedRoutines()).toEqual(["review"]);
  });

  it("does nothing when the review's trigger isn't set up", async () => {
    env = { ...env, COACH_REVIEW_FIRE_TOKEN: undefined } as unknown as Env;
    logSession("17:00");
    expect(await check("17:30")).toEqual([]);
    expect(fired).toEqual([]);
  });

  it("logs a failed start and retries a few times", async () => {
    status = 429;
    logSession("17:00");
    const [first] = await check("17:30");
    expect(first).toMatchObject({ status: "failed", routine: "review" });
    expect(first.error).toMatch(/too often/);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await check(`17:${30 + 5 * i}`);
    await check("17:55");
    expect(fired).toHaveLength(MAX_ATTEMPTS);
  });

  it("recovers on a retry after a failure", async () => {
    status = 500;
    logSession("17:00");
    await check("17:30");
    status = 200;
    const [ok] = await check("17:35");
    expect(ok.status).toBe("started");
    await check("17:40");
    expect(fired).toHaveLength(2);
  });
});

describe("autoStartStatus", () => {
  it("is off without the review's trigger", async () => {
    env = { ...env, COACH_REVIEW_FIRE_URL: undefined } as unknown as Env;
    expect(await autoStartStatus(env, at("17:00"))).toMatchObject({ enabled: false, worker: false, next_start: null, last: null });
  });

  it("says when the waiting session's review is due, then what was started", async () => {
    expect(await autoStartStatus(env, at("17:00"))).toMatchObject({ enabled: true, worker: true, delay_min: 30, next_start: null, last: null });
    logSession("17:00");
    expect((await autoStartStatus(env, at("17:10"))).next_start).toBe("2026-05-10T17:30:00Z");
    await check("17:30");
    const s = await autoStartStatus(env, at("17:31"));
    expect(s.next_start).toBeNull();
    expect(s.last).toMatchObject({ routine: "review", status: "started" });
  });
});

describe("startFromApp", () => {
  it("starts the routine and logs it as an app start, which doesn't count as following up a session", async () => {
    logSession("17:00");
    expect(await startFromApp(env, "review", at("17:05"))).toEqual({ session_url: "https://claude.ai/code/session_1" });
    expect(sqlite.prepare("SELECT routine, started_by, status FROM routine_starts").all()).toEqual([
      { routine: "review", started_by: "app", status: "started" },
    ]);
    expect(fired[0].text).toContain("Started from the app");
    await check("17:30");
    expect(firedRoutines()).toEqual(["review", "review"]);
  });

  it("passes failures back without logging them", async () => {
    status = 401;
    await expect(startFromApp(env, "worker", at("17:05"))).rejects.toThrow(/token was rejected/);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM routine_starts").get()).toEqual({ n: 0 });
  });
});
