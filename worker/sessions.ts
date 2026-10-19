// Session edits shared by the app (PUT/DELETE /api/sessions/:id) and the MCP update_session /
// delete_session tools (issue #17). SESSION_FIELDS is the whitelist of editable columns: a new column
// is added here with its check, schema and, if stored differently, toDb.

import { BadRequest, NotFound } from "./errors";
import { isIsoDate } from "./injury-dates";
import { type FieldSpec, isInt, isString, oneOf, pickPatch, updateByIdSql } from "./partial";
import { SESSION_TAGS, TAG_LIST_MESSAGE, TAG_TYPES, TAG_TYPE_MESSAGE, isTagList, tagsColumn } from "./tags";
import { GYM_MESSAGE, isGymInput, normalizeGym } from "./gyms";
import { isRpe } from "./timerSession";
import { isClimbingType } from "./typeGroups";

export const SESSION_TYPES = ["boulder", "board", "lead", "toprope", "hangboard", "strength", "cardio", "mobility", "other"];

// Indoor/outdoor (#33): sessions.outdoor is 1 outdoors, 0 indoors (the default). The app and MCP send a
// boolean (0/1 accepted too). Only climbing types can be outdoor, handled like tags: outdoor on a
// non-climbing session is rejected, and changing an outdoor session to a non-climbing type sets it back
// to indoor (applyTypeRules).
// The climbing types (worker/typeGroups.ts) in SESSION_TYPES order, for messages and schemas.
export const OUTDOOR_TYPES = SESSION_TYPES.filter(isClimbingType);
export const OUTDOOR_MESSAGE = "outdoor must be true or false";
export const OUTDOOR_TYPE_MESSAGE = `outdoor is only for ${OUTDOOR_TYPES.join(", ")} sessions`;
const isFlag = (v: unknown) => typeof v === "boolean" || v === 0 || v === 1;
export const outdoorColumn = (v: unknown): 0 | 1 => (v ? 1 : 0);

// Validates outdoor sent by the app or log_session (missing = indoor). Returns an error message, or null.
export function outdoorError(input: unknown, type: string): string | null {
  if (input == null) return null;
  if (!isFlag(input)) return OUTDOOR_MESSAGE;
  if (input && !isClimbingType(type)) return OUTDOOR_TYPE_MESSAGE;
  return null;
}

export const SESSION_FIELDS: Record<string, FieldSpec> = {
  date: { check: isIsoDate, message: "date must be YYYY-MM-DD", schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" } },
  type: { check: oneOf(SESSION_TYPES), message: `type must be one of ${SESSION_TYPES.join(", ")}`, schema: { type: "string", enum: SESSION_TYPES } },
  duration_min: { check: isInt(1), message: "duration_min must be a whole number of minutes >= 1", schema: { type: "integer", minimum: 1 } },
  rpe: { check: isRpe, message: "rpe must be 1-10", schema: { type: "integer", minimum: 1, maximum: 10, description: "Effort 1-10" } },
  max_grade: { check: isString, message: "max_grade must be text", nullable: true, schema: { type: ["string", "null"], description: "Hardest send; null clears it" } },
  notes: { check: isString, message: "notes must be text", nullable: true, schema: { type: ["string", "null"], description: "Replaces the whole note; null clears it" } },
  // Pinned link to a plan entry (#21, worker/plan.ts). The app's full-replace edit leaves it alone (db.updateSession).
  plan_id: { check: isInt(1), message: "plan_id must be a plan entry id (integer)", nullable: true, schema: { type: ["integer", "null"], description: "Pin to this plan entry (e.g. a planned session done on another day); null goes back to automatic matching by date and type" } },
  // Stored comma-separated (worker/tags.ts). Only on climbing types: see applyTypeRules, which needs the type.
  tags: {
    check: isTagList,
    message: TAG_LIST_MESSAGE,
    nullable: true,
    toDb: (v) => tagsColumn(v as string[]),
    schema: {
      type: ["array", "null"],
      items: { type: "string", enum: SESSION_TAGS },
      description: `Style tags (${TAG_TYPES.join(", ")} only); replaces the whole list, [] or null clears them. Weight finger load.`,
    },
  },
  // Free text (#48, worker/gyms.ts). Callers map it onto an existing spelling first (db.resolveGym).
  gym: {
    check: isGymInput,
    message: GYM_MESSAGE,
    nullable: true,
    toDb: normalizeGym,
    schema: { type: ["string", "null"], description: "Gym the session was at; reuse a name from get_overview's gyms. null clears it" },
  },
  // Stored 0/1. Only on climbing types: see applyTypeRules. Not nullable (false = indoors).
  outdoor: {
    check: isFlag,
    message: OUTDOOR_MESSAGE,
    toDb: outdoorColumn,
    schema: { type: "boolean", description: `Climbed outdoors (${OUTDOOR_TYPES.join(", ")} only); false = indoors` },
  },
};

export const SESSION_COLUMNS = Object.keys(SESSION_FIELDS);

export const sessionId = (v: unknown): number => {
  if (!Number.isInteger(v) || (v as number) < 1) throw new BadRequest("id must be a session id (integer)");
  return v as number;
};

// The editable fields in args, validated. args.id is the caller's business.
export const sessionPatch = (args: Record<string, unknown>) => pickPatch(SESSION_FIELDS, args, ["id"]);

// Tags (TAG_TYPES) and outdoor (CLIMBING_TYPES, the same list) only belong on climbing types. A partial
// edit is checked against the stored row: tags or outdoor on a session that is (or becomes) non-climbing
// are rejected, and changing a session's type to a non-climbing one clears its tags and sets it back to
// indoor. `patch` is a sessionPatch (values already in column form).
export interface StoredSession {
  type: string;
  tags: string | null;
  outdoor?: number | null;
}

export function applyTypeRules(patch: Record<string, unknown>, current: StoredSession | null): Record<string, unknown> {
  if (!current) return patch; // no such session: the update reports it
  const type = (patch.type as string | undefined) ?? current.type;
  const typeChanged = patch.type !== undefined;
  let out = patch;
  if (!TAG_TYPES.includes(type)) {
    if (patch.tags != null) throw new BadRequest(TAG_TYPE_MESSAGE);
    if (patch.tags === undefined && typeChanged && current.tags) out = { ...out, tags: null };
  }
  if (!isClimbingType(type)) {
    if (patch.outdoor === 1) throw new BadRequest(OUTDOOR_TYPE_MESSAGE);
    if (patch.outdoor === undefined && typeChanged && current.outdoor) out = { ...out, outdoor: 0 };
  }
  return out;
}

// sessionPatch plus applyTypeRules against the stored session.
export async function checkedSessionPatch(db: D1Database, id: number, args: Record<string, unknown>) {
  const patch = sessionPatch(args);
  const current = await db.prepare("SELECT type, tags, outdoor FROM sessions WHERE id = ?").bind(id).first<StoredSession>();
  return applyTypeRules(patch, current);
}

// Changes only the given columns and marks the session edited. Returns the updated row, or null if no such id.
// A new date also moves the benchmark results entered with the session (they carry its date, issue #22).
export async function updateSessionFields(db: D1Database, id: number, values: Record<string, unknown>) {
  const { sql, params } = updateByIdSql("sessions", id, SESSION_COLUMNS, values, "updated_at");
  if (values.date === undefined) return db.prepare(sql).bind(...params).first();
  const [updated] = await db.batch([
    db.prepare(sql).bind(...params),
    db.prepare("UPDATE benchmarks SET date = (SELECT date FROM sessions WHERE id = ?) WHERE session_id = ?").bind(id, id),
  ]);
  return (updated.results[0] as Record<string, unknown> | undefined) ?? null;
}

// Returns the deleted row. Injuries and benchmark results linked to it stay, with session_id set to NULL
// (foreign keys).
export async function deleteSession(db: D1Database, id: number) {
  return db.prepare("DELETE FROM sessions WHERE id = ? RETURNING *").bind(id).first();
}

export async function requireSession(db: D1Database, id: number) {
  if (!(await db.prepare("SELECT 1 FROM sessions WHERE id = ?").bind(id).first())) throw new NotFound(`Session ${id} not found`);
}
