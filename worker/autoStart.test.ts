// Starting the coach review, then the issue worker, when a session is logged: the real SQL on an in-memory
// SQLite behind a minimal D1 shim, with Claude's fire endpoint and GitHub stubbed. Made-up data only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_START_TEXT, TIMER_SETTLE_MIN, autoStartStatus, startAfterWrite, startFromApp } from "./autoStart";
import type { Env } from "./db";
import { workerIssueNumbers } from "./github";
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

interface Item {
  number: number;
  title?: string;
  body?: string | null;
  user?: { login: string };
  labels?: string[];
  pr?: boolean;
}
const item = (i: Item) => ({
  number: i.number,
  title: i.title ?? `Item ${i.number}`,
  body: i.body ?? null,
  user: i.user ?? { login: "someowner" },
  labels: (i.labels ?? []).map((name) => ({ name })),
  ...(i.pr ? { pull_request: {} } : {}),
});

let sqlite: DatabaseSync;
let env: Env;
let fired: { url: string; text: string }[];
let status: number;
let openItems: ReturnType<typeof item>[];
let githubDown: boolean;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  env = {
    DB: d1(sqlite),
    COACH_REVIEW_FIRE_URL: REVIEW_URL,
    COACH_REVIEW_FIRE_TOKEN: "sk-ant-oat01-test-review",
    ISSUE_WORKER_FIRE_URL: WORKER_URL,
    ISSUE_WORKER_FIRE_TOKEN: "sk-ant-oat01-test-worker",
    GITHUB_TOKEN: "github-test-token",
    GITHUB_REPO: "someowner/somerepo",
    GITHUB_ROADMAP_ISSUE: "1",
  } as unknown as Env;
  fired = [];
  status = 200;
  openItems = [item({ number: 5, labels: ["bug", "priority: P1"] })];
  githubDown = false;
  resetCooldowns();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.startsWith("https://api.github.com/")) {
      return githubDown ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(openItems));
    }
    fired.push({ url, text: JSON.parse(String(init.body)).text });
    return new Response(JSON.stringify({ claude_code_session_url: `https://claude.ai/code/session_${fired.length}` }), { status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const at = (hhmm: string) => new Date(`2026-05-10T${hhmm}:00Z`);
const logSession = (hhmm: string, clientId: string | null = null) =>
  sqlite
    .prepare("INSERT INTO sessions (date, type, duration_min, rpe, client_id, created_at) VALUES ('2026-05-10', 'boulder', 60, 7, ?, ?)")
    .run(clientId, `2026-05-10T${hhmm}:00Z`);
const recordReview = (hhmm: string) =>
  sqlite
    .prepare("INSERT INTO coach_runs (outcome, seen_through, created_at) VALUES ('no_change', ?, ?)")
    .run(`2026-05-10T${hhmm}:00Z`, `2026-05-10T${hhmm}:00Z`);
// Each write is a separate request, so the in-memory double-tap guard doesn't carry over.
const write = (hhmm: string, timerKey?: string) => {
  resetCooldowns();
  return startAfterWrite(env, at(hhmm), timerKey);
};
const firedRoutines = () => fired.map((f) => (f.url === REVIEW_URL ? "review" : "worker"));
const starts = () => sqlite.prepare("SELECT routine, session_id, status, error FROM routine_starts ORDER BY id").all();

describe("review", () => {
  it("does nothing without a logged session", async () => {
    expect(await write("18:00")).toEqual([]);
    expect(fired).toEqual([]);
  });

  it("starts as soon as a session is logged, once", async () => {
    logSession("17:00");
    expect(await write("17:00")).toEqual(["review"]);
    expect(fired[0]).toEqual({ url: REVIEW_URL, text: REVIEW_START_TEXT });
    expect(await write("17:01")).toEqual([]);
    expect(starts()).toEqual([{ routine: "review", session_id: 1, status: "started", error: null }]);
  });

  it("starts again for the next session", async () => {
    logSession("09:00");
    await write("09:00");
    logSession("18:00");
    await write("18:00");
    expect(firedRoutines()).toEqual(["review", "review"]);
  });

  it("ignores sessions logged long ago, e.g. right after deploying", async () => {
    logSession("01:00");
    expect(await write("18:00")).toEqual([]);
  });

  it("doesn't restart for an older session once the newest one is deleted", async () => {
    logSession("17:00");
    logSession("17:10");
    await write("17:10");
    sqlite.prepare("DELETE FROM sessions WHERE id = 2").run();
    expect(await write("17:11")).toEqual([]);
  });

  it("waits for the timer's Save and close, since the run may still become a warm-up", async () => {
    logSession("17:00", "hang-abc:session");
    expect(await write("17:00")).toEqual([]); // the hang log insert
    expect(await write("17:01", "hang-other")).toEqual([]); // another run's Save and close
    expect(await write("17:01", "hang-abc")).toEqual(["review"]);
  });

  it("counts a timer session without Save and close once it has settled", async () => {
    logSession("17:00", "hang-abc:session");
    expect(await write(`17:0${TIMER_SETTLE_MIN - 1}`)).toEqual([]);
    expect(await write(`17:${TIMER_SETTLE_MIN}`)).toEqual(["review"]);
  });

  it("logs a failed start and leaves it to Run now", async () => {
    status = 429;
    logSession("17:00");
    await write("17:00");
    await write("17:05");
    expect(fired).toHaveLength(1);
    expect(starts()).toEqual([{ routine: "review", session_id: 1, status: "failed", error: expect.stringMatching(/too often/) }]);
  });

  it("does nothing when the review's trigger isn't set up", async () => {
    env = { ...env, COACH_REVIEW_FIRE_TOKEN: undefined } as unknown as Env;
    logSession("17:00");
    expect(await write("17:00")).toEqual([]);
    expect(fired).toEqual([]);
  });

  it("can't be started twice by writes at the same moment", async () => {
    logSession("17:00");
    resetCooldowns();
    const [a, b] = await Promise.all([startAfterWrite(env, at("17:00")), startAfterWrite(env, at("17:00"))]);
    expect([...a, ...b]).toEqual(["review"]);
  });
});

describe("worker", () => {
  it("starts once the review has recorded its run, with the issues to do and no limit", async () => {
    logSession("17:00");
    await write("17:00");
    expect(await write("17:02")).toEqual([]); // review still running
    recordReview("17:04");
    expect(await write("17:04")).toEqual(["worker"]); // record_coach_run's own write
    expect(fired[1].url).toBe(WORKER_URL);
    expect(fired[1].text).toContain("#5");
    expect(fired[1].text).toContain("no per-run limit");
    await write("17:10");
    expect(firedRoutines()).toEqual(["review", "worker"]);
  });

  it("is skipped when there are no issues for it", async () => {
    openItems = [item({ number: 6, labels: ["enhancement", "priority: P2", "backlog"] })];
    logSession("17:00");
    await write("17:00");
    recordReview("17:04");
    await write("17:04");
    expect(firedRoutines()).toEqual(["review"]);
    expect(starts()[1]).toEqual({ routine: "worker", session_id: 1, status: "skipped", error: "No open P0 or P1 issues to work on." });
    await write("17:05");
    expect(starts()).toHaveLength(2);
  });

  it("starts anyway when GitHub can't be checked", async () => {
    githubDown = true;
    logSession("17:00");
    await write("17:00");
    recordReview("17:04");
    await write("17:04");
    expect(firedRoutines()).toEqual(["review", "worker"]);
    expect(fired[1].text).not.toContain("#");
  });

  it("starts without the check when no GitHub token is set", async () => {
    env = { ...env, GITHUB_TOKEN: undefined } as unknown as Env;
    openItems = [];
    logSession("17:00");
    await write("17:00");
    recordReview("17:04");
    await write("17:04");
    expect(firedRoutines()).toEqual(["review", "worker"]);
  });

  it("doesn't follow a coach run recorded before the automatic review started", async () => {
    recordReview("16:50");
    logSession("17:00");
    await write("17:00");
    expect(await write("17:01")).toEqual([]);
  });

  it("doesn't follow a review that failed to start", async () => {
    status = 500;
    logSession("17:00");
    await write("17:00");
    status = 200;
    recordReview("17:04");
    expect(await write("17:04")).toEqual([]);
  });

  it("isn't started when its trigger isn't set up", async () => {
    env = { ...env, ISSUE_WORKER_FIRE_URL: undefined } as unknown as Env;
    logSession("17:00");
    await write("17:00");
    recordReview("17:04");
    await write("17:04");
    expect(firedRoutines()).toEqual(["review"]);
  });
});

describe("workerIssueNumbers", () => {
  it("follows the worker's own rules", () => {
    const items = [
      item({ number: 1, labels: ["priority: P0"] }), // the roadmap issue
      item({ number: 2, labels: ["bug", "priority: P0"] }),
      item({ number: 3, labels: ["priority: P1"], user: { login: "someone-else" } }),
      item({ number: 4, labels: ["priority: P2"] }),
      item({ number: 7, labels: ["priority: P1", "needs-owner"] }),
      item({ number: 8, labels: ["priority: P1"] }), // has an open PR
      item({ number: 9, labels: ["bug"] }),
      item({ number: 10, labels: ["priority: P1", "enhancement"] }),
      item({ number: 11, title: "Fix the thing", body: "Closes #8", pr: true, labels: ["priority: P1"] }),
    ];
    expect(workerIssueNumbers(items, "SomeOwner", 1)).toEqual([2, 10]);
  });
});

describe("autoStartStatus", () => {
  it("is off without the review's trigger", async () => {
    env = { ...env, COACH_REVIEW_FIRE_URL: undefined } as unknown as Env;
    expect(await autoStartStatus(env)).toEqual({ enabled: false, worker: false, last: null });
  });

  it("shows the newest automatic start", async () => {
    expect(await autoStartStatus(env)).toEqual({ enabled: true, worker: true, last: null });
    logSession("17:00");
    await write("17:00");
    expect((await autoStartStatus(env)).last).toMatchObject({ routine: "review", status: "started", session_url: "https://claude.ai/code/session_1" });
  });
});

describe("startFromApp", () => {
  it("starts the routine and logs it as an app start, which doesn't count as following up a session", async () => {
    logSession("17:00", "hang-abc:session");
    expect(await startFromApp(env, "review", at("17:01"))).toEqual({ session_url: "https://claude.ai/code/session_1" });
    expect(sqlite.prepare("SELECT routine, started_by, status FROM routine_starts").all()).toEqual([
      { routine: "review", started_by: "app", status: "started" },
    ]);
    expect(fired[0].text).toContain("Started from the app");
    await write("17:02", "hang-abc");
    expect(firedRoutines()).toEqual(["review", "review"]);
  });

  it("tells a hand-started worker to do every issue", async () => {
    await startFromApp(env, "worker", at("17:01"));
    expect(fired[0].text).toContain("no per-run limit");
  });

  it("passes failures back without logging them", async () => {
    status = 401;
    await expect(startFromApp(env, "worker", at("17:05"))).rejects.toThrow(/token was rejected/);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM routine_starts").get()).toEqual({ n: 0 });
  });
});
