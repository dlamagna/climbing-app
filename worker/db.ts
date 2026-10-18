// Data access shared by the phone app's REST API and the MCP server.

import {
  type BenchmarkResult,
  type ExpectedBenchmark,
  decodeExpected,
  encodeExpected,
  missingBenchmarks,
  parseExpectedBenchmarks,
} from "./benchmarks";
import { CHECKIN_COLUMNS, checkinUpsertSql } from "./checkins";
import { FINGER_TYPES, addDays, computeLoadStats, loadWindow, mondayOf, type LoadRow } from "./load";
import { allColumns } from "./partial";
import { type PlanRow, type PlanStatus, type SessionRow, adherence, planView, weekSummary } from "./plan";
import { type ReadinessCheckin, type ReadinessInjury, readiness } from "./readiness";
import { SESSION_COLUMNS, updateSessionFields } from "./sessions";

export { FINGER_TYPES, addDays, mondayOf, type WeekLoad } from "./load";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_TOKEN?: string;
  MCP_TOKEN?: string;
  GITHUB_TOKEN?: string; // optional, enables the issue tools (see worker/github.ts)
  GITHUB_REPO?: string; // "owner/repo"
}

type Row = Record<string, unknown>;

export function todayIn(timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function all<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function getProfile(db: D1Database): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(db, "SELECT key, value FROM profile ORDER BY key");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function updateProfile(db: D1Database, values: Record<string, string | null>) {
  const stmts = Object.entries(values).map(([key, value]) =>
    value === null || value === ""
      ? db.prepare("DELETE FROM profile WHERE key = ?").bind(key)
      : db
          .prepare(
            `INSERT INTO profile (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value,
               updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
          )
          .bind(key, String(value)),
  );
  if (stmts.length) await db.batch(stmts);
}

export interface Checkin {
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  feeling?: number | null;
  drinks?: number | null;
  protein?: string | null;
  weight_kg?: number | null;
  note?: string | null;
}

// The app saves the whole form, so every column is written (missing ones as null). MCP's partial
// update uses the same builder with only the fields it was given (worker/checkins.ts).
function checkinStmt(db: D1Database, date: string, c: Checkin) {
  const { sql, params } = checkinUpsertSql(date, allColumns(CHECKIN_COLUMNS, c as Record<string, unknown>));
  return db.prepare(sql).bind(...params);
}

export async function upsertCheckin(db: D1Database, date: string, c: Checkin) {
  await checkinStmt(db, date, c).run();
}

// Moves a check-in to another day (still one per day: it replaces whatever was on the new date).
export async function moveCheckin(db: D1Database, from: string, to: string, c: Checkin) {
  await db.batch([checkinStmt(db, to, c), db.prepare("DELETE FROM checkins WHERE date = ?").bind(from)]);
}

export interface Session {
  date: string;
  type: string;
  duration_min: number;
  rpe: number;
  max_grade?: string | null;
  notes?: string | null;
  plan_id?: number | null; // pinned link to a plan entry (see worker/plan.ts); NULL = auto-matched
  tags?: string | null; // column value: comma-separated, see worker/tags.ts
}

// clientId makes the insert idempotent: replaying the same write returns the original row's id.
export async function insertSession(db: D1Database, s: Session, clientId: string | null = null): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO sessions (date, type, duration_min, rpe, max_grade, notes, plan_id, tags, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
    )
    .bind(s.date, s.type, s.duration_min, s.rpe, s.max_grade ?? null, s.notes ?? null, s.plan_id ?? null, s.tags ?? null, clientId)
    .first<{ id: number }>();
  return row?.id ?? (await idForClientId(db, "sessions", clientId!));
}

export async function idForClientId(db: D1Database, table: "sessions" | "hang_logs" | "injuries", clientId: string): Promise<number> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE client_id = ?`).bind(clientId).first<{ id: number }>();
  return row!.id;
}

// The app's edit form sends every field; see worker/sessions.ts for the column whitelist. plan_id is the
// exception: only changed when passed (the edit form doesn't send it), so an edit keeps a pinned plan link.
export async function updateSession(db: D1Database, id: number, s: Session): Promise<boolean> {
  const values = allColumns(SESSION_COLUMNS.filter((c) => c !== "plan_id"), s as unknown as Record<string, unknown>);
  if (s.plan_id !== undefined) values.plan_id = s.plan_id;
  return (await updateSessionFields(db, id, values)) !== null;
}

export interface PlanEntry {
  date: string;
  title: string;
  type?: string | null;
  intensity?: string | null;
  details?: string | null;
  duration_min?: number | null;
  expected_benchmarks?: ExpectedBenchmark[] | null; // tests planned that day, see worker/benchmarks.ts
}

// Writes plan entries. With replaceDates, existing entries on those dates are removed first,
// so re-planning a week doesn't leave duplicates behind (their status overrides and pinned session links go
// with them; statuses are re-derived against the new entries).
export async function setPlan(db: D1Database, entries: PlanEntry[], replaceDates: boolean) {
  const dates = [...new Set(entries.map((e) => e.date))];
  const expected = entries.map((e) => encodeExpected(parseExpectedBenchmarks(e.expected_benchmarks)));
  const stmts = [
    ...(replaceDates ? dates.map((d) => db.prepare("DELETE FROM plan WHERE date = ?").bind(d)) : []),
    ...entries.map((e, i) =>
      db
        .prepare("INSERT INTO plan (date, title, type, intensity, details, duration_min, expected_benchmarks) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(e.date, e.title, e.type ?? null, e.intensity ?? null, e.details ?? null, e.duration_min ?? null, expected[i]),
    ),
  ];
  if (stmts.length) await db.batch(stmts);
}

const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

// Plan entries from..to with their derived status and conflict flags (worker/plan.ts), and expected_benchmarks
// as a list ([] when none) rather than the stored JSON. Reads a wider window so conflicts see the last week
// and the next planned days whatever range the caller asked for.
export async function getPlan(db: D1Database, from: string, to: string, today: string) {
  const lo = minDate(from, addDays(today, -7));
  const hi = maxDate(to, addDays(today, 14));
  const [entries, sessions] = await Promise.all([
    all<PlanRow & Row>(db, "SELECT * FROM plan WHERE date BETWEEN ? AND ? ORDER BY date, id", lo, hi).then((rows) =>
      rows.map((r) => ({ ...r, expected_benchmarks: decodeExpected(r.expected_benchmarks) })),
    ),
    all<SessionRow>(
      db,
      `SELECT id, date, type, duration_min, rpe, plan_id FROM sessions
       WHERE date BETWEEN ? AND ? OR plan_id IN (SELECT id FROM plan WHERE date BETWEEN ? AND ?)`,
      lo, hi, lo, hi,
    ),
  ]);
  const view = planView(entries, sessions, today);
  return {
    entries: view.entries.filter((e) => e.date >= from && e.date <= to),
    all: view.entries,
    sessions,
    conflicts: view.conflicts,
  };
}

// Hand-picked status for a plan entry; null goes back to automatic.
export async function setPlanStatus(db: D1Database, id: number, status: PlanStatus | null): Promise<boolean> {
  const { meta } = await db.prepare("UPDATE plan SET status_override = ? WHERE id = ?").bind(status, id).run();
  return meta.changes > 0;
}

// Benchmark results entered with a session: upserted per (session, name) with the session's date, cleared
// ones removed. (Editing a session's date moves its results too, see updateSessionFields.)
export function sessionBenchmarkStmts(
  db: D1Database,
  sessionId: number,
  date: string,
  writes: { save: BenchmarkResult[]; clear: string[] },
) {
  return [
    ...writes.clear.map((name) =>
      db.prepare("DELETE FROM benchmarks WHERE session_id = ? AND name = ?").bind(sessionId, name),
    ),
    ...writes.save.map((b) =>
      db
        .prepare(
          `INSERT INTO benchmarks (date, name, value, unit, session_id) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (session_id, name) DO UPDATE SET date = excluded.date, value = excluded.value, unit = excluded.unit`,
        )
        .bind(date, b.name, b.value, b.unit, sessionId),
    ),
  ];
}

export async function addCoachNote(db: D1Database, date: string, text: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO coach_notes (date, text) VALUES (?, ?) RETURNING id")
    .bind(date, text)
    .first<{ id: number }>();
  return row!.id;
}

// Each update carries the load of the day before, so Claude can tell whether a session aggravated it.
export async function activeInjuries(db: D1Database) {
  const injuries = await all<Row & { id: number }>(
    db,
    `SELECT i.*, s.date AS session_date, s.type AS session_type, s.duration_min AS session_duration_min,
       s.rpe AS session_rpe
     FROM injuries i LEFT JOIN sessions s ON s.id = i.session_id
     WHERE i.resolved_on IS NULL ORDER BY i.started_on`,
  );
  const fingerTypes = FINGER_TYPES.map((t) => `'${t}'`).join(", ");
  for (const inj of injuries) {
    inj.updates = await all(
      db,
      `SELECT u.date, u.pain, u.trend, u.stiffness, u.red_flags, u.note,
         (SELECT SUM(duration_min * rpe) FROM sessions WHERE date = date(u.date, '-1 day')) AS load_day_before,
         (SELECT SUM(duration_min * rpe) FROM sessions
          WHERE date = date(u.date, '-1 day') AND type IN (${fingerTypes})) AS finger_load_day_before
       FROM injury_updates u WHERE u.injury_id = ? ORDER BY u.date DESC, u.id DESC LIMIT 14`,
      inj.id,
    );
  }
  return injuries;
}

// Training load stats (7-day vs previous 28 days, with a cold-start baseline); see worker/load.ts.
export async function loadStats(db: D1Database, today: string, weeks = 6) {
  const { from, to } = loadWindow(today, weeks);
  const [rows, first] = await Promise.all([
    all<LoadRow>(db, "SELECT date, type, duration_min * rpe AS load, tags FROM sessions WHERE date BETWEEN ? AND ?", from, to),
    db.prepare("SELECT MIN(date) AS first FROM sessions WHERE date <= ?").bind(today).first<{ first: string | null }>(),
  ]);
  return computeLoadStats(rows, today, first?.first ?? null, weeks);
}

export async function history(db: D1Database, from: string, to: string) {
  const [sessions, checkins, hangs] = await Promise.all([
    all(db, "SELECT * FROM sessions WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC", from, to),
    all(db, "SELECT * FROM checkins WHERE date BETWEEN ? AND ? ORDER BY date DESC", from, to),
    all(db, "SELECT * FROM hang_logs WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC", from, to),
  ]);
  return { sessions, checkins, hangs };
}

export async function todayView(db: D1Database, today: string) {
  const [checkin, lastCheckin, plan, coachNotes, sessions, injuries, load] = await Promise.all([
    db.prepare("SELECT * FROM checkins WHERE date = ?").bind(today).first(),
    db.prepare("SELECT * FROM checkins WHERE date < ? ORDER BY date DESC LIMIT 1").bind(today).first(),
    getPlan(db, mondayOf(today), addDays(today, 6), today), // from Monday for the week-so-far line
    all(db, "SELECT * FROM coach_notes WHERE date >= ? ORDER BY date DESC, id DESC LIMIT 3", addDays(today, -1)),
    all(db, "SELECT * FROM sessions WHERE date = ? ORDER BY id", today),
    activeInjuries(db),
    loadStats(db, today, 4),
  ]);
  return {
    today,
    checkin,
    last_checkin: lastCheckin,
    plan: plan.entries,
    plan_conflicts: plan.conflicts,
    coach_notes: coachNotes,
    sessions,
    injuries,
    load,
    readiness: todayReadiness(today, checkin, load, plan, injuries),
  };
}

// The same call for the app and the coach (worker/readiness.ts). getPlan's sessions and entries always cover
// the last 7 days, which is all readiness looks at.
function todayReadiness(
  today: string,
  checkin: unknown,
  load: Awaited<ReturnType<typeof loadStats>>,
  plan: Awaited<ReturnType<typeof getPlan>>,
  injuries: Row[],
) {
  return readiness((checkin as ReadinessCheckin | null) ?? null, load, plan.sessions, {
    today,
    injuries: injuries as unknown as ReadinessInjury[],
    plan: plan.all,
  });
}

// Everything Claude needs to answer "how should I train today?" in one call.
export async function overview(db: D1Database, today: string, days: number) {
  const from = addDays(today, -(days - 1));
  const [profile, injuries, load, hist, plan, coachNotes, benchmarks, resolved, tests] = await Promise.all([
    getProfile(db),
    activeInjuries(db),
    loadStats(db, today, 6),
    history(db, from, today),
    getPlan(db, from, addDays(today, 7), today),
    all(db, "SELECT date, text FROM coach_notes ORDER BY date DESC, id DESC LIMIT 5"),
    all(db, "SELECT date, name, value, unit, notes FROM benchmarks ORDER BY date DESC LIMIT 30"),
    all(db, "SELECT body_part, side, started_on, resolved_on FROM injuries WHERE resolved_on IS NOT NULL ORDER BY resolved_on DESC LIMIT 5"),
    benchmarkOverview(db, today),
  ]);
  return {
    today,
    weekday: new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
    profile,
    active_injuries: injuries,
    recently_resolved_injuries: resolved,
    training_load: load,
    readiness: todayReadiness(today, hist.checkins.find((c) => c.date === today), load, plan, injuries),
    checkins: hist.checkins,
    sessions: hist.sessions,
    hangboard: hist.hangs,
    plan_past_and_next_7_days: plan.entries,
    plan_adherence: adherence(plan.all, plan.sessions, from, today),
    plan_week_so_far: weekSummary(plan.all, today),
    plan_conflicts: plan.conflicts,
    recent_coach_notes: coachNotes,
    benchmarks,
    ...tests,
  };
}

// Benchmark names already in use (so planned tests reuse them and charts line up) and planned tests from
// the last 7 days that have no result yet (so the coach can reschedule them).
async function benchmarkOverview(db: D1Database, today: string) {
  const [names, plan, logged] = await Promise.all([
    all(db, "SELECT name, unit, COUNT(*) AS results, MAX(date) AS last_date FROM benchmarks GROUP BY name, unit ORDER BY name"),
    all<{ date: string; title: string; expected_benchmarks: string }>(
      db,
      "SELECT date, title, expected_benchmarks FROM plan WHERE date BETWEEN ? AND ? AND expected_benchmarks IS NOT NULL",
      addDays(today, -7),
      addDays(today, -1),
    ).then((rows) => rows.map((r) => ({ ...r, expected_benchmarks: decodeExpected(r.expected_benchmarks) }))),
    all<{ date: string; name: string }>(db, "SELECT date, name FROM benchmarks WHERE date BETWEEN ? AND ?", addDays(today, -7), today),
  ]);
  return { benchmark_names: names, missing_benchmarks_last_7_days: missingBenchmarks(plan, logged, today, 7) };
}
