// Injury writes shared by the app's /api/injuries routes (worker/index.ts) and the MCP injury tools
// (worker/mcp-writes.ts, issue #17), so both validate and store the same way. The injuries table is the
// only place injury state lives (issue #20); see worker/profile-injury.ts for the profile side.

import { idForClientId } from "./db";
import { BadRequest, NotFound } from "./errors";
import { injuryDatesError, isIsoDate } from "./injury-dates";
import { allColumns, isInt, upsertSql } from "./partial";
import { requireSession } from "./sessions";

export const INJURY_TRENDS = ["better", "same", "worse", "gone"];
export const RED_FLAGS = ["swelling", "numbness", "night_pain"];
export const SIDES = ["left", "right", "both"];

export const isPain = isInt(0, 10);

export interface NewInjury {
  body_part: string;
  side?: string | null;
  description?: string | null;
  resolved_on?: string | null; // set when an already-healed injury is recorded after the fact
}

// Only the descriptive fields: dates and links are set by each caller.
export function parseNewInjury(i: any): NewInjury {
  if (typeof i?.body_part !== "string" || !i.body_part.trim()) throw new BadRequest("body_part is required");
  if (i.side != null && !SIDES.includes(i.side)) throw new BadRequest(`side must be one of ${SIDES.join(", ")}`);
  if (i.description != null && typeof i.description !== "string") throw new BadRequest("description must be text");
  return { body_part: i.body_part.trim(), side: i.side ?? null, description: i.description ?? null };
}

export interface InjuryReport extends NewInjury {
  started_on: string;
  resolved_on: string | null;
  session_id: number | null;
  pain: number | null; // pain on started_on, stored as that day's update
}

// today also rejects dates after it (MCP knows the climber's date; the REST API doesn't, so it passes none).
export function parseInjuryReport(i: any, today?: string): InjuryReport {
  const dateError = injuryDatesError(i?.started_on, i?.resolved_on, today);
  if (dateError) throw new BadRequest(dateError);
  if (i.session_id != null && !(Number.isInteger(i.session_id) && i.session_id > 0)) throw new BadRequest("session_id must be a session id (integer)");
  if (i.pain != null && !isPain(i.pain)) throw new BadRequest("pain must be a whole number 0-10");
  return {
    ...parseNewInjury(i),
    started_on: i.started_on,
    resolved_on: i.resolved_on || null,
    session_id: i.session_id ?? null,
    pain: i.pain ?? null,
  };
}

export interface InjuryUpdate {
  injury_id: number;
  pain: number;
  trend?: string | null;
  stiffness?: number | null;
  red_flags?: string[] | null;
  note?: string | null;
}

// Keys that aren't passed stay undefined, so a merging write (MCP) can leave them untouched.
export function parseInjuryUpdate(u: any): InjuryUpdate {
  if (!(Number.isInteger(u?.injury_id) && u.injury_id > 0)) throw new BadRequest("injury_id is required (integer)");
  if (!isPain(u.pain)) throw new BadRequest("pain (whole number 0-10) is required");
  if (u.trend != null && !INJURY_TRENDS.includes(u.trend)) throw new BadRequest(`trend must be one of ${INJURY_TRENDS.join(", ")}`);
  if (u.red_flags != null && !(Array.isArray(u.red_flags) && u.red_flags.every((f: unknown) => RED_FLAGS.includes(f as string)))) {
    throw new BadRequest(`red_flags must be a list of ${RED_FLAGS.join(", ")}`);
  }
  if (u.stiffness != null && ![true, false, 0, 1].includes(u.stiffness)) throw new BadRequest("stiffness must be true/false (or 1/0)");
  if (u.note != null && typeof u.note !== "string") throw new BadRequest("note must be text");
  const out: InjuryUpdate = { injury_id: u.injury_id, pain: u.pain };
  if (u.trend !== undefined) out.trend = u.trend;
  if (u.stiffness !== undefined) out.stiffness = u.stiffness === null ? null : Number(u.stiffness);
  if (u.red_flags !== undefined) out.red_flags = u.red_flags;
  if (u.note !== undefined) out.note = u.note;
  return out;
}

// A day an update is for: a real date, and with today (MCP) not in the future.
export function checkUpdateDate(date: unknown, today?: string): string {
  if (!isIsoDate(date)) throw new BadRequest("date must be YYYY-MM-DD");
  if (today && date > today) throw new BadRequest("date can't be in the future");
  return date;
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
      `INSERT INTO injuries (body_part, side, description, started_on, resolved_on, session_id, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
    )
    .bind(i.body_part, i.side ?? null, i.description ?? null, startedOn, i.resolved_on ?? null, sessionId, clientId);
}

const UPDATE_COLUMNS = ["pain", "trend", "stiffness", "red_flags", "note"];

// One update per injury per day. The app re-submits the whole row (replace); with merge (MCP), only the
// fields passed change, so a note added later keeps the morning's trend and stiffness.
export function injuryUpdateSql(date: string, u: InjuryUpdate, merge = false) {
  const values: Record<string, unknown> = {
    pain: u.pain,
    trend: u.trend,
    stiffness: u.stiffness,
    red_flags: u.red_flags === undefined ? undefined : u.red_flags?.length ? u.red_flags.join(",") : null,
    note: u.note,
  };
  return upsertSql("injury_updates", { injury_id: u.injury_id, date }, UPDATE_COLUMNS, merge ? values : allColumns(UPDATE_COLUMNS, values));
}

// The update, and for trend "gone" resolving the injury on that date.
export function injuryUpdateStmts(db: D1Database, date: string, u: InjuryUpdate, merge = false) {
  const { sql, params } = injuryUpdateSql(date, u, merge);
  const stmts = [db.prepare(sql).bind(...params)];
  if (u.trend === "gone") {
    stmts.push(
      db.prepare("UPDATE injuries SET resolved_on = ? WHERE id = ? AND resolved_on IS NULL").bind(date, u.injury_id),
    );
  }
  return stmts;
}

async function injuryStart(db: D1Database, id: number): Promise<string> {
  const row = await db.prepare("SELECT started_on FROM injuries WHERE id = ?").bind(id).first<{ started_on: string }>();
  if (!row) throw new NotFound(`Injury ${id} not found`);
  return row.started_on;
}

// session_id, if given, must be an existing session.
export async function reportInjury(db: D1Database, r: InjuryReport, clientId: string | null = null): Promise<{ id: number }> {
  if (r.session_id !== null) await requireSession(db, r.session_id);
  const row = await insertInjury(db, r, r.started_on, r.session_id, clientId).first<{ id: number }>();
  if (!row) return { id: await idForClientId(db, "injuries", clientId!) }; // replayed
  if (r.pain !== null) await db.batch(injuryUpdateStmts(db, r.started_on, { injury_id: row.id, pain: r.pain }));
  return { id: row.id };
}

export async function addInjuryUpdate(db: D1Database, date: string, u: InjuryUpdate, merge = false) {
  await injuryStart(db, u.injury_id);
  await db.batch(injuryUpdateStmts(db, date, u, merge));
}

// date may be in the past (healed a while ago), but not before the injury started.
export async function resolveInjury(db: D1Database, id: number, date: string, today?: string) {
  const dateError = injuryDatesError(await injuryStart(db, id), date, today);
  if (dateError) throw new BadRequest(dateError);
  await db.prepare("UPDATE injuries SET resolved_on = ? WHERE id = ?").bind(date, id).run();
}

// Makes a healed injury active again. With undoDate (the undo toast after tapping "gone"), that day's
// "gone" update is dropped too, since it was a mis-tap rather than a real recovery.
export async function reopenInjury(db: D1Database, id: number, undoDate?: unknown) {
  await injuryStart(db, id);
  await db.batch([
    db.prepare("UPDATE injuries SET resolved_on = NULL WHERE id = ?").bind(id),
    ...(isIsoDate(undoDate)
      ? [db.prepare("DELETE FROM injury_updates WHERE injury_id = ? AND date = ? AND trend = 'gone'").bind(id, undoDate)]
      : []),
  ]);
}
