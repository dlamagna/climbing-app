// Session edits shared by the app (PUT/DELETE /api/sessions/:id) and the MCP update_session /
// delete_session tools (issue #17). SESSION_FIELDS is the whitelist of editable columns: a new column
// is added here with its check, schema and, if stored differently, toDb.

import { BadRequest, NotFound } from "./errors";
import { isIsoDate } from "./injury-dates";
import { type FieldSpec, isInt, isString, oneOf, pickPatch, updateByIdSql } from "./partial";
import { SESSION_TAGS, TAG_LIST_MESSAGE, TAG_TYPES, TAG_TYPE_MESSAGE, isTagList, tagsColumn } from "./tags";
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
  // Stored comma-separated (worker/tags.ts). Only on climbing types: see applyTagRule, which needs the type.
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
};

export const SESSION_COLUMNS = Object.keys(SESSION_FIELDS);

export const sessionId = (v: unknown): number => {
  if (!Number.isInteger(v) || (v as number) < 1) throw new BadRequest("id must be a session id (integer)");
  return v as number;
};

// The editable fields in args, validated. args.id is the caller's business.
export const sessionPatch = (args: Record<string, unknown>) => pickPatch(SESSION_FIELDS, args, ["id"]);

// Tags only belong on climbing types (TAG_TYPES). A partial edit is checked against the stored row:
// tags on a session that is (or becomes) non-climbing are rejected, and changing a tagged session's type
// to a non-climbing one clears its tags. `patch` is a sessionPatch (tags already in column form).
export function applyTagRule(
  patch: Record<string, unknown>,
  current: { type: string; tags: string | null } | null,
): Record<string, unknown> {
  if (!current) return patch; // no such session: the update reports it
  const type = (patch.type as string | undefined) ?? current.type;
  if (TAG_TYPES.includes(type)) return patch;
  if (patch.tags != null) throw new BadRequest(TAG_TYPE_MESSAGE);
  if (patch.tags === undefined && patch.type !== undefined && current.tags) return { ...patch, tags: null };
  return patch;
}

// sessionPatch plus applyTagRule against the stored session.
export async function checkedSessionPatch(db: D1Database, id: number, args: Record<string, unknown>) {
  const patch = sessionPatch(args);
  const current = await db
    .prepare("SELECT type, tags FROM sessions WHERE id = ?")
    .bind(id)
    .first<{ type: string; tags: string | null }>();
  return applyTagRule(patch, current);
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
