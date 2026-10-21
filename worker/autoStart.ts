// Start the coach review, then the issue worker, after a training session is logged.
//
// A Cloudflare cron trigger (wrangler.jsonc) calls checkAutoStarts every few minutes:
// 1. Review: once the newest session has been in for AUTO_DELAY_MIN minutes, with no newer one logged in
//    the meantime, start the review. Logging another session restarts the wait, so a gym session and a
//    hangboard run logged close together get one review.
// 2. Worker: once that review has recorded its run (coach_runs), start the issue worker. If the review never
//    records one (it failed), the worker starts anyway after WORKER_FALLBACK_MIN minutes.
//
// Only rows in sessions count. A hangboard run marked as a warm-up has no session row (worker/timerLog.ts),
// so it never starts anything. Both routines can still be started by hand from Coach → Coach activity.
// Each start is a row in routine_starts, which is how the next check knows a session was followed up.

import { nowStamp } from "./coach";
import type { Env } from "./db";
import { type RoutineName, fireRoutine, routinesAvailable } from "./routines";

export const AUTO_DELAY_MIN = 30;
// The worker starts anyway this long after the review was started, if the review hasn't recorded a run.
export const WORKER_FALLBACK_MIN = 60;
// Sessions logged longer ago than this never start anything, e.g. right after this feature is deployed, or
// when the triggers are set up long after the last session.
export const SESSION_WINDOW_HOURS = 12;
// Failed starts for the same session are retried on the next checks, up to this many attempts.
export const MAX_ATTEMPTS = 3;

const MIN_MS = 60_000;

export type StartedBy = "session" | "app";

export interface RoutineStart {
  id: number;
  routine: RoutineName;
  started_by: StartedBy;
  session_logged_at: string | null;
  status: "started" | "failed";
  error: string | null;
  session_url: string | null;
  created_at: string;
}

const START_TEXT: Record<RoutineName, string> = {
  review: `Started automatically ${AUTO_DELAY_MIN} minutes after a training session was logged.`,
  worker: "Started automatically after the coach review that followed a logged training session.",
};

const minutesSince = (stamp: string, now: Date) => (now.getTime() - Date.parse(stamp)) / MIN_MS;

async function insertStart(
  db: D1Database,
  s: Omit<RoutineStart, "id" | "created_at">,
  now: Date,
): Promise<RoutineStart> {
  const created_at = nowStamp(now);
  const row = await db
    .prepare(
      `INSERT INTO routine_starts (routine, started_by, session_logged_at, status, error, session_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(s.routine, s.started_by, s.session_logged_at, s.status, s.error, s.session_url, created_at)
    .first<{ id: number }>();
  return { ...s, id: row!.id, created_at };
}

async function startForSession(env: Env, routine: RoutineName, sessionLoggedAt: string, now: Date): Promise<RoutineStart> {
  const base = { routine, started_by: "session" as const, session_logged_at: sessionLoggedAt };
  try {
    const { session_url } = await fireRoutine(env, routine, now.getTime(), START_TEXT[routine]);
    return await insertStart(env.DB, { ...base, status: "started", error: null, session_url }, now);
  } catch (e) {
    return await insertStart(env.DB, { ...base, status: "failed", error: (e as Error).message, session_url: null }, now);
  }
}

const startsFor = (db: D1Database, routine: RoutineName, sessionLoggedAt: string) =>
  db
    .prepare(
      `SELECT SUM(status = 'started') AS started, SUM(status = 'failed') AS failed FROM routine_starts
       WHERE started_by = 'session' AND routine = ? AND session_logged_at = ?`,
    )
    .bind(routine, sessionLoggedAt)
    .first<{ started: number | null; failed: number | null }>()
    .then((r) => ({ started: r?.started ?? 0, failed: r?.failed ?? 0 }));

// The session the next automatic review waits for: the newest one, if it was logged within the window and
// after the newest session an earlier automatic review already followed up. Its created_at, or null.
export async function waitingSession(db: D1Database, now: Date): Promise<string | null> {
  const newest = await db
    .prepare("SELECT created_at FROM sessions ORDER BY created_at DESC, id DESC LIMIT 1")
    .first<{ created_at: string }>();
  if (!newest || !(minutesSince(newest.created_at, now) <= SESSION_WINDOW_HOURS * 60)) return null;
  const covered = await db
    .prepare(
      `SELECT MAX(session_logged_at) AS at FROM routine_starts
       WHERE started_by = 'session' AND routine = 'review' AND status = 'started'`,
    )
    .first<{ at: string | null }>();
  if (covered?.at && covered.at >= newest.created_at) return null;
  const { failed } = await startsFor(db, "review", newest.created_at);
  return failed < MAX_ATTEMPTS ? newest.created_at : null;
}

// The newest automatic review start that still needs its worker run, with whether the worker may start now.
async function workerDue(db: D1Database, now: Date): Promise<string | null> {
  const review = await db
    .prepare(
      `SELECT session_logged_at, created_at FROM routine_starts
       WHERE started_by = 'session' AND routine = 'review' AND status = 'started' ORDER BY id DESC LIMIT 1`,
    )
    .first<{ session_logged_at: string; created_at: string }>();
  if (!review || !(minutesSince(review.created_at, now) <= SESSION_WINDOW_HOURS * 60)) return null;
  const { started, failed } = await startsFor(db, "worker", review.session_logged_at);
  if (started > 0 || failed >= MAX_ATTEMPTS) return null;
  const recorded = await db
    .prepare("SELECT 1 AS done FROM coach_runs WHERE created_at >= ? LIMIT 1")
    .bind(review.created_at)
    .first<{ done: number }>();
  return recorded || minutesSince(review.created_at, now) >= WORKER_FALLBACK_MIN ? review.session_logged_at : null;
}

// The cron trigger's check. Returns the starts it attempted (for the log and tests).
export async function checkAutoStarts(env: Env, now = new Date()): Promise<RoutineStart[]> {
  const available = routinesAvailable(env);
  if (!available.review) return [];
  const done: RoutineStart[] = [];

  const waiting = await waitingSession(env.DB, now);
  if (waiting && minutesSince(waiting, now) >= AUTO_DELAY_MIN) done.push(await startForSession(env, "review", waiting, now));

  if (available.worker) {
    const due = await workerDue(env.DB, now);
    if (due) done.push(await startForSession(env, "worker", due, now));
  }
  return done;
}

// "Run now" on the Coach tab. Errors go back to the app as before; a successful start is logged.
export async function startFromApp(env: Env, routine: RoutineName, now = new Date()): Promise<{ session_url: string | null }> {
  const result = await fireRoutine(env, routine, now.getTime());
  await insertStart(
    env.DB,
    { routine, started_by: "app", session_logged_at: null, status: "started", error: null, session_url: result.session_url },
    now,
  ).catch(() => undefined); // the start already happened; a failed log line mustn't turn it into an error
  return result;
}

export interface AutoStartStatus {
  enabled: boolean; // the review's API trigger is set up, so sessions start it
  worker: boolean; // the issue worker follows it
  delay_min: number;
  next_start: string | null; // UTC timestamp: when the review is due for the session waiting, if any
  last: RoutineStart | null; // the newest automatic start
}

// For the Coach tab's coach activity.
export async function autoStartStatus(env: Env, now = new Date()): Promise<AutoStartStatus> {
  const available = routinesAvailable(env);
  const status: AutoStartStatus = { enabled: available.review, worker: available.review && available.worker, delay_min: AUTO_DELAY_MIN, next_start: null, last: null };
  if (!status.enabled) return status;
  const waiting = await waitingSession(env.DB, now);
  if (waiting) status.next_start = nowStamp(new Date(Date.parse(waiting) + AUTO_DELAY_MIN * MIN_MS));
  status.last = await env.DB
    .prepare("SELECT * FROM routine_starts WHERE started_by = 'session' ORDER BY id DESC LIMIT 1")
    .first<RoutineStart>();
  return status;
}
