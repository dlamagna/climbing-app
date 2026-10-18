// Check-in columns and the partial upsert the MCP connector uses (issue #17). The app's full-form save
// (worker/db.ts) goes through the same builder with every column.

import { type FieldSpec, isInt, isNumber, isString, oneOf, pickPatch, upsertSql } from "./partial";

export const CHECKIN_FIELDS: Record<string, FieldSpec> = {
  sleep_hours: { check: isNumber(0, 24), message: "sleep_hours must be 0-24", nullable: true, schema: { type: ["number", "null"], minimum: 0, maximum: 24 } },
  sleep_quality: { check: isInt(1, 3), message: "sleep_quality must be 1, 2 or 3", nullable: true, schema: { type: ["integer", "null"], minimum: 1, maximum: 3, description: "1 bad, 2 ok, 3 good" } },
  feeling: { check: isInt(1, 5), message: "feeling must be 1-5", nullable: true, schema: { type: ["integer", "null"], minimum: 1, maximum: 5, description: "1 wrecked .. 5 fresh" } },
  drinks: { check: isInt(0), message: "drinks must be a whole number >= 0", nullable: true, schema: { type: ["integer", "null"], minimum: 0, description: "Alcoholic drinks the day before" } },
  protein: { check: oneOf(["low", "ok", "high"]), message: "protein must be low, ok or high", nullable: true, schema: { type: ["string", "null"], enum: ["low", "ok", "high", null], description: "Rough, for the day before" } },
  weight_kg: { check: isNumber(1, 500), message: "weight_kg must be a number of kg", nullable: true, schema: { type: ["number", "null"] } },
  note: { check: isString, message: "note must be text", nullable: true, schema: { type: ["string", "null"] } },
};

export const CHECKIN_COLUMNS = Object.keys(CHECKIN_FIELDS);

// The check-in fields in args, validated. args.date is the caller's business.
export const checkinPatch = (args: Record<string, unknown>) => pickPatch(CHECKIN_FIELDS, args, ["date"]);

export const checkinUpsertSql = (date: string, values: Record<string, unknown>) =>
  upsertSql("checkins", { date }, CHECKIN_COLUMNS, values, "updated_at");

// Creates the day's check-in or changes only the given fields of an existing one. Returns the row.
export async function upsertCheckinPartial(db: D1Database, date: string, patch: Record<string, unknown>) {
  const { sql, params } = checkinUpsertSql(date, patch);
  return db.prepare(`${sql} RETURNING *`).bind(...params).first();
}
