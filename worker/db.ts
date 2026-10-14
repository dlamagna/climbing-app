// Data access shared by the phone app's REST API and the MCP server.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_TOKEN?: string;
  MCP_TOKEN?: string;
  GITHUB_TOKEN?: string; // optional, enables the issue tools (see worker/github.ts)
  GITHUB_REPO?: string; // "owner/repo"
}

type Row = Record<string, unknown>;

// Session types that load the fingers; tracked separately because tendons adapt slower than muscle.
export const FINGER_TYPES = ["boulder", "board", "lead", "hangboard"];

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

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

const checkinStmt = (db: D1Database, date: string, c: Checkin) =>
  db
    .prepare(
      `INSERT INTO checkins (date, sleep_hours, sleep_quality, feeling, drinks, protein, weight_kg, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
         feeling = excluded.feeling, drinks = excluded.drinks, protein = excluded.protein,
         weight_kg = excluded.weight_kg, note = excluded.note,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(
      date,
      c.sleep_hours ?? null,
      c.sleep_quality ?? null,
      c.feeling ?? null,
      c.drinks ?? null,
      c.protein ?? null,
      c.weight_kg ?? null,
      c.note ?? null,
    );

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
}

// clientId makes the insert idempotent: replaying the same write returns the original row's id.
export async function insertSession(db: D1Database, s: Session, clientId: string | null = null): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO sessions (date, type, duration_min, rpe, max_grade, notes, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
    )
    .bind(s.date, s.type, s.duration_min, s.rpe, s.max_grade ?? null, s.notes ?? null, clientId)
    .first<{ id: number }>();
  return row?.id ?? (await idForClientId(db, "sessions", clientId!));
}

export async function idForClientId(db: D1Database, table: "sessions" | "hang_logs" | "injuries", clientId: string): Promise<number> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE client_id = ?`).bind(clientId).first<{ id: number }>();
  return row!.id;
}

export async function updateSession(db: D1Database, id: number, s: Session): Promise<boolean> {
  const { meta } = await db
    .prepare(`UPDATE sessions SET date = ?, type = ?, duration_min = ?, rpe = ?, max_grade = ?, notes = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`)
    .bind(s.date, s.type, s.duration_min, s.rpe, s.max_grade ?? null, s.notes ?? null, id)
    .run();
  return meta.changes > 0;
}

export interface PlanEntry {
  date: string;
  title: string;
  type?: string | null;
  intensity?: string | null;
  details?: string | null;
}

// Writes plan entries. With replaceDates, existing entries on those dates are removed first,
// so re-planning a week doesn't leave duplicates behind.
export async function setPlan(db: D1Database, entries: PlanEntry[], replaceDates: boolean) {
  const dates = [...new Set(entries.map((e) => e.date))];
  const stmts = [
    ...(replaceDates ? dates.map((d) => db.prepare("DELETE FROM plan WHERE date = ?").bind(d)) : []),
    ...entries.map((e) =>
      db
        .prepare("INSERT INTO plan (date, title, type, intensity, details) VALUES (?, ?, ?, ?, ?)")
        .bind(e.date, e.title, e.type ?? null, e.intensity ?? null, e.details ?? null),
    ),
  ];
  if (stmts.length) await db.batch(stmts);
}

export async function getPlan(db: D1Database, from: string, to: string) {
  return all(db, "SELECT * FROM plan WHERE date BETWEEN ? AND ? ORDER BY date, id", from, to);
}

export async function addCoachNote(db: D1Database, date: string, text: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO coach_notes (date, text) VALUES (?, ?) RETURNING id")
    .bind(date, text)
    .first<{ id: number }>();
  return row!.id;
}

export const INJURY_TRENDS = ["better", "same", "worse", "gone"];
export const RED_FLAGS = ["swelling", "numbness", "night_pain"];

export interface NewInjury {
  body_part: string;
  side?: string | null;
  description?: string | null;
}

// clientId makes the insert idempotent, as for sessions; a replay returns no row.
export function insertInjury(
  db: D1Database,
  i: NewInjury,
  startedOn: string,
  sessionId: number | null = null,
  clientId: string | null = null,
) {
  return db
    .prepare(
      `INSERT INTO injuries (body_part, side, description, started_on, session_id, client_id)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
    )
    .bind(i.body_part, i.side ?? null, i.description ?? null, startedOn, sessionId, clientId);
}

export interface InjuryUpdate {
  injury_id: number;
  pain: number;
  trend?: string | null;
  stiffness?: number | null;
  red_flags?: string[] | null;
  note?: string | null;
}

// One update per injury per day: re-submitting the same day replaces it. "gone" also resolves the injury.
export function injuryUpdateStmts(db: D1Database, date: string, u: InjuryUpdate) {
  const stmts = [
    db
      .prepare(
        `INSERT INTO injury_updates (injury_id, date, pain, trend, stiffness, red_flags, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (injury_id, date) DO UPDATE SET
           pain = excluded.pain, trend = excluded.trend, stiffness = excluded.stiffness,
           red_flags = excluded.red_flags, note = excluded.note`,
      )
      .bind(
        u.injury_id,
        date,
        u.pain,
        u.trend ?? null,
        u.stiffness ?? null,
        u.red_flags?.length ? u.red_flags.join(",") : null,
        u.note ?? null,
      ),
  ];
  if (u.trend === "gone") {
    stmts.push(
      db.prepare("UPDATE injuries SET resolved_on = ? WHERE id = ? AND resolved_on IS NULL").bind(date, u.injury_id),
    );
  }
  return stmts;
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

export interface WeekLoad {
  week_start: string;
  total: number;
  finger: number;
  sessions: number;
}

// Training load = minutes x effort (session-RPE). Compares the last 7 days against the average
// week of the 28 days before; a ratio well above ~1.3 means load is ramping up quickly.
export async function loadStats(db: D1Database, today: string, weeks = 6) {
  const from = addDays(mondayOf(today), -7 * (weeks - 1));
  const earliest = from < addDays(today, -34) ? from : addDays(today, -34);
  const rows = await all<{ date: string; type: string; load: number }>(
    db,
    "SELECT date, type, duration_min * rpe AS load FROM sessions WHERE date BETWEEN ? AND ?",
    earliest,
    today,
  );

  const sum = (lo: string, hi: string, fingerOnly: boolean) =>
    rows
      .filter((r) => r.date >= lo && r.date <= hi && (!fingerOnly || FINGER_TYPES.includes(r.type)))
      .reduce((acc, r) => acc + r.load, 0);

  const acuteFrom = addDays(today, -6);
  const chronicFrom = addDays(today, -34);
  const chronicTo = addDays(today, -7);
  const last7 = { total: sum(acuteFrom, today, false), finger: sum(acuteFrom, today, true) };
  const prevWeeklyAvg = {
    total: Math.round(sum(chronicFrom, chronicTo, false) / 4),
    finger: Math.round(sum(chronicFrom, chronicTo, true) / 4),
  };
  const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

  const byWeek: WeekLoad[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 6);
    byWeek.push({
      week_start: start,
      total: sum(start, end, false),
      finger: sum(start, end, true),
      sessions: rows.filter((r) => r.date >= start && r.date <= end).length,
    });
  }

  return {
    last7,
    prev28_weekly_avg: prevWeeklyAvg,
    ratio_total: ratio(last7.total, prevWeeklyAvg.total),
    ratio_finger: ratio(last7.finger, prevWeeklyAvg.finger),
    weeks: byWeek,
  };
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
    getPlan(db, today, addDays(today, 6)),
    all(db, "SELECT * FROM coach_notes WHERE date >= ? ORDER BY date DESC, id DESC LIMIT 3", addDays(today, -1)),
    all(db, "SELECT * FROM sessions WHERE date = ? ORDER BY id", today),
    activeInjuries(db),
    loadStats(db, today, 4),
  ]);
  return { today, checkin, last_checkin: lastCheckin, plan, coach_notes: coachNotes, sessions, injuries, load };
}

// Everything Claude needs to answer "how should I train today?" in one call.
export async function overview(db: D1Database, today: string, days: number) {
  const from = addDays(today, -(days - 1));
  const [profile, injuries, load, hist, plan, coachNotes, benchmarks, resolved] = await Promise.all([
    getProfile(db),
    activeInjuries(db),
    loadStats(db, today, 6),
    history(db, from, today),
    getPlan(db, from, addDays(today, 7)),
    all(db, "SELECT date, text FROM coach_notes ORDER BY date DESC, id DESC LIMIT 5"),
    all(db, "SELECT date, name, value, unit, notes FROM benchmarks ORDER BY date DESC LIMIT 30"),
    all(db, "SELECT body_part, side, started_on, resolved_on FROM injuries WHERE resolved_on IS NOT NULL ORDER BY resolved_on DESC LIMIT 5"),
  ]);
  return {
    today,
    weekday: new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
    profile,
    active_injuries: injuries,
    recently_resolved_injuries: resolved,
    training_load: load,
    checkins: hist.checkins,
    sessions: hist.sessions,
    hangboard: hist.hangs,
    plan_past_and_next_7_days: plan,
    recent_coach_notes: coachNotes,
    benchmarks,
  };
}
