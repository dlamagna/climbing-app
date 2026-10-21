// Start the coach review, then the issue worker, when a training session is logged.
//
// Event-driven: after every successful write from the app or MCP, the Worker calls startAfterWrite (in
// waitUntil, so the write's response isn't held up). It works out from the database what is due:
// 1. Review: the newest session hasn't been followed up yet, so POST to the review's API trigger now.
//    Sessions from the hangboard timer wait for its Save and close (POST /hangs/by-key/:key/done), because the
//    timer saves the run before the climber picks warm-up or training; a warm-up has no session row
//    (worker/timerLog.ts), so it never starts anything. If Save and close never arrives (an older app
//    version), the timer session counts from the first write TIMER_SETTLE_MIN minutes after it.
// 2. Worker: the review that followed a session has recorded its run (record_coach_run is itself an MCP
//    write). Start the issue worker only if GitHub has open issues it would work on (workerIssues).
// Each start is claimed with one INSERT ... WHERE NOT EXISTS, so concurrent writes can't start it twice, and
// is kept in routine_starts. A failed start isn't retried automatically: Run now on the Coach tab does that.

import { nowStamp } from "./coach";
import type { Env } from "./db";
import { githubEnabled, workerIssues } from "./github";
import { type RoutineName, fireRoutine, routinesAvailable } from "./routines";

// Sessions logged longer ago than this never start anything, e.g. right after this feature is deployed.
export const SESSION_WINDOW_HOURS = 12;
export const TIMER_SETTLE_MIN = 10;
const TIMER_SESSION = /:session$/; // client_id of a timer session (worker/timerSession.ts)

export type StartedBy = "session" | "app";
export type StartStatus = "starting" | "started" | "failed" | "skipped";

export interface RoutineStart {
  id: number;
  routine: RoutineName;
  started_by: StartedBy;
  session_id: number | null;
  status: StartStatus;
  error: string | null;
  session_url: string | null;
  created_at: string;
}

export const REVIEW_START_TEXT = "Started automatically because a training session was just logged.";
export const workerStartText = (issues: number[] | null) =>
  "Started automatically after the coach review that followed a logged training session. " +
  (issues?.length ? `Open issues to work on: ${issues.map((n) => `#${n}`).join(", ")}. ` : "") +
  "Work on every eligible issue in this run, one after another, with no per-run limit, until none are left.";

const minutesSince = (stamp: string, now: Date) => (now.getTime() - Date.parse(stamp)) / 60_000;

// Claims a start: inserts a 'starting' row unless `taken` finds one already. Returns its id, or null.
async function claim(db: D1Database, routine: RoutineName, sessionId: number, taken: string, now: Date) {
  const row = await db
    .prepare(
      `INSERT INTO routine_starts (routine, started_by, session_id, status, created_at)
       SELECT ?, 'session', ?, 'starting', ? WHERE NOT EXISTS (${taken}) RETURNING id`,
    )
    .bind(routine, sessionId, nowStamp(now), sessionId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

const finish = (db: D1Database, id: number, status: StartStatus, error: string | null, url: string | null = null) =>
  db.prepare("UPDATE routine_starts SET status = ?, error = ?, session_url = ? WHERE id = ?").bind(status, error, url, id).run();

async function fire(env: Env, id: number, routine: RoutineName, text: string, now: Date) {
  try {
    const { session_url } = await fireRoutine(env, routine, now.getTime(), text);
    await finish(env.DB, id, "started", null, session_url);
  } catch (e) {
    await finish(env.DB, id, "failed", (e as Error).message);
  }
}

// The newest session, if it should start a review now. `doneTimerKey`: the hang log client_id whose
// Save and close this write is.
async function sessionToReview(db: D1Database, now: Date, doneTimerKey?: string) {
  const s = await db
    .prepare("SELECT id, created_at, client_id FROM sessions ORDER BY id DESC LIMIT 1")
    .first<{ id: number; created_at: string; client_id: string | null }>();
  if (!s || !(minutesSince(s.created_at, now) <= SESSION_WINDOW_HOURS * 60)) return null;
  const timerDone = doneTimerKey !== undefined && s.client_id === `${doneTimerKey}:session`;
  if (s.client_id && TIMER_SESSION.test(s.client_id) && !timerDone && minutesSince(s.created_at, now) < TIMER_SETTLE_MIN) return null;
  return s.id;
}

async function startReview(env: Env, now: Date, doneTimerKey?: string): Promise<boolean> {
  const sessionId = await sessionToReview(env.DB, now, doneTimerKey);
  if (sessionId === null) return false;
  // Taken: a review already followed up this session or a newer one.
  const id = await claim(
    env.DB,
    "review",
    sessionId,
    "SELECT 1 FROM routine_starts WHERE started_by = 'session' AND routine = 'review' AND session_id >= ?",
    now,
  );
  if (id === null) return false;
  await fire(env, id, "review", REVIEW_START_TEXT, now);
  return true;
}

async function startWorker(env: Env, now: Date): Promise<boolean> {
  const review = await env.DB
    .prepare(
      `SELECT session_id, created_at FROM routine_starts
       WHERE started_by = 'session' AND routine = 'review' AND status = 'started' ORDER BY id DESC LIMIT 1`,
    )
    .first<{ session_id: number; created_at: string }>();
  if (!review || !(minutesSince(review.created_at, now) <= SESSION_WINDOW_HOURS * 60)) return false;
  const recorded = await env.DB
    .prepare("SELECT 1 AS done FROM coach_runs WHERE created_at >= ? LIMIT 1")
    .bind(review.created_at)
    .first<{ done: number }>();
  if (!recorded) return false; // the review is still running
  const id = await claim(
    env.DB,
    "worker",
    review.session_id,
    "SELECT 1 FROM routine_starts WHERE started_by = 'session' AND routine = 'worker' AND session_id = ?",
    now,
  );
  if (id === null) return false;

  // Only start it when there's something to do. Without a GitHub token, or if GitHub can't be reached, the
  // worker decides for itself.
  let issues: number[] | null = null;
  if (githubEnabled(env)) {
    try {
      issues = await workerIssues(env);
    } catch {
      issues = null;
    }
    if (issues?.length === 0) {
      await finish(env.DB, id, "skipped", "No open P0 or P1 issues to work on.");
      return true;
    }
  }
  await fire(env, id, "worker", workerStartText(issues), now);
  return true;
}

// Called after every successful write. Returns which routines it tried to start (for tests).
export async function startAfterWrite(env: Env, now = new Date(), doneTimerKey?: string): Promise<RoutineName[]> {
  const available = routinesAvailable(env);
  if (!available.review) return [];
  const tried: RoutineName[] = [];
  if (await startReview(env, now, doneTimerKey)) tried.push("review");
  if (available.worker && (await startWorker(env, now))) tried.push("worker");
  return tried;
}

// "Run now" on the Coach tab. Errors go back to the app as before; a successful start is logged.
export async function startFromApp(env: Env, routine: RoutineName, now = new Date()): Promise<{ session_url: string | null }> {
  const result = await fireRoutine(
    env,
    routine,
    now.getTime(),
    routine === "worker" ? "Started from the app (Coach → Coach activity). Work on every eligible issue in this run, with no per-run limit." : undefined,
  );
  await env.DB
    .prepare(
      `INSERT INTO routine_starts (routine, started_by, status, session_url, created_at) VALUES (?, 'app', 'started', ?, ?)`,
    )
    .bind(routine, result.session_url, nowStamp(now))
    .run()
    .catch(() => undefined); // the start already happened; a failed log line mustn't turn it into an error
  return result;
}

export interface AutoStartStatus {
  enabled: boolean; // the review's API trigger is set up, so logged sessions start it
  worker: boolean; // the issue worker follows it
  last: RoutineStart | null; // the newest automatic start
}

// For the Coach tab's coach activity.
export async function autoStartStatus(env: Env): Promise<AutoStartStatus> {
  const available = routinesAvailable(env);
  const status: AutoStartStatus = { enabled: available.review, worker: available.review && available.worker, last: null };
  if (!status.enabled) return status;
  status.last = await env.DB
    .prepare("SELECT * FROM routine_starts WHERE started_by = 'session' ORDER BY id DESC LIMIT 1")
    .first<RoutineStart>();
  return status;
}
