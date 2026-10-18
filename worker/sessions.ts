// Session edits shared by the app (PUT/DELETE /api/sessions/:id) and the MCP update_session /
// delete_session tools (issue #17). SESSION_FIELDS is the whitelist of editable columns: a new column
// (e.g. tags) is added here with its check, schema and, if stored differently, toDb.

import { BadRequest, NotFound } from "./errors";
import { isIsoDate } from "./injury-dates";
import { type FieldSpec, isInt, isString, oneOf, pickPatch, updateByIdSql } from "./partial";
import { isRpe } from "./timerSession";

export const SESSION_TYPES = ["boulder", "board", "lead", "hangboard", "strength", "cardio", "mobility", "other"];

export const SESSION_FIELDS: Record<string, FieldSpec> = {
  date: { check: isIsoDate, message: "date must be YYYY-MM-DD", schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" } },
  type: { check: oneOf(SESSION_TYPES), message: `type must be one of ${SESSION_TYPES.join(", ")}`, schema: { type: "string", enum: SESSION_TYPES } },
  duration_min: { check: isInt(1), message: "duration_min must be a whole number of minutes >= 1", schema: { type: "integer", minimum: 1 } },
  rpe: { check: isRpe, message: "rpe must be 1-10", schema: { type: "integer", minimum: 1, maximum: 10, description: "Effort 1-10" } },
  max_grade: { check: isString, message: "max_grade must be text", nullable: true, schema: { type: ["string", "null"], description: "Hardest send; null clears it" } },
  notes: { check: isString, message: "notes must be text", nullable: true, schema: { type: ["string", "null"], description: "Replaces the whole note; null clears it" } },
  // Pinned link to a plan entry (#21, worker/plan.ts). The app's full-replace edit leaves it alone (db.updateSession).
  plan_id: { check: isInt(1), message: "plan_id must be a plan entry id (integer)", nullable: true, schema: { type: ["integer", "null"], description: "Pin to this plan entry (e.g. a planned session done on another day); null goes back to automatic matching by date and type" } },
};

export const SESSION_COLUMNS = Object.keys(SESSION_FIELDS);

export const sessionId = (v: unknown): number => {
  if (!Number.isInteger(v) || (v as number) < 1) throw new BadRequest("id must be a session id (integer)");
  return v as number;
};

// The editable fields in args, validated. args.id is the caller's business.
export const sessionPatch = (args: Record<string, unknown>) => pickPatch(SESSION_FIELDS, args, ["id"]);

// Changes only the given columns and marks the session edited. Returns the updated row, or null if no such id.
export async function updateSessionFields(db: D1Database, id: number, values: Record<string, unknown>) {
  const { sql, params } = updateByIdSql("sessions", id, SESSION_COLUMNS, values, "updated_at");
  return db.prepare(sql).bind(...params).first();
}

// Returns the deleted row. Injuries linked to it stay, with session_id set to NULL (foreign key).
export async function deleteSession(db: D1Database, id: number) {
  return db.prepare("DELETE FROM sessions WHERE id = ? RETURNING *").bind(id).first();
}

export async function requireSession(db: D1Database, id: number) {
  if (!(await db.prepare("SELECT 1 FROM sessions WHERE id = ?").bind(id).first())) throw new NotFound(`Session ${id} not found`);
}
