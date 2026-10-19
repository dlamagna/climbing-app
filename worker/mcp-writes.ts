// MCP tools that write injuries and fix sessions (issue #17), so telling Claude about a session or a
// morning can do everything the app can. Validation and queries are shared with the app's REST routes
// (worker/injuries.ts, worker/sessions.ts).

import {
  INJURY_TRENDS,
  RED_FLAGS,
  SIDES,
  addInjuryUpdate,
  checkUpdateDate,
  parseInjuryReport,
  parseInjuryUpdate,
  reopenInjury,
  reportInjury,
  resolveInjury,
} from "./injuries";
import { type Tool, dateSchema, todayFor } from "./mcp-common";
import { NotFound } from "./errors";
import { schemaOf } from "./partial";
import { SESSION_FIELDS, checkedSessionPatch, deleteSession, sessionId, updateSessionFields } from "./sessions";
import { TAG_TYPES } from "./tags";

const nullableDate = { type: ["string", "null"], pattern: dateSchema.pattern };

export const WRITE_TOOLS: Tool[] = [
  {
    name: "report_injury",
    description:
      "Record a new injury in the injuries table, the only place injury state lives (never the profile). It then gets a daily follow-up row in the app's morning check-in. Check get_overview's active_injuries first: for an injury that is already tracked use add_injury_update. Can be backdated (started_on), and an injury that has already healed can be recorded in one step with resolved_on.",
    inputSchema: {
      type: "object",
      properties: {
        body_part: {
          type: "string",
          description:
            "Start with one of the app's areas (Finger, Wrist, Elbow, Shoulder, Neck / back, Hip, Knee, Ankle, Skin, Other), optionally ' - ' and detail, e.g. 'Finger - ring finger A2 pulley'",
        },
        side: { type: "string", enum: SIDES },
        description: { type: "string", description: "What happened: move, feeling (pop? gradual?), what makes it hurt" },
        started_on: { ...dateSchema, description: "When it started (YYYY-MM-DD). Defaults to today in the climber's timezone; not in the future." },
        resolved_on: { ...dateSchema, description: "Only for an injury that has already healed: the day it healed (>= started_on)" },
        session_id: { type: "integer", description: "The session it happened in (ids are in get_overview's sessions)" },
        pain: { type: "integer", minimum: 0, maximum: 10, description: "Pain on started_on, 0 none .. 10 worst; saved as that day's update" },
      },
      required: ["body_part"],
    },
    annotations: { destructiveHint: false },
    run: async (a, env) => {
      const today = await todayFor(env);
      const report = parseInjuryReport({ ...a, started_on: a.started_on ?? today }, today);
      return { ...(await reportInjury(env.DB, report)), started_on: report.started_on, resolved_on: report.resolved_on };
    },
  },
  {
    name: "add_injury_update",
    description:
      "Record an injury's pain for a day (what the morning check-in asks). One update per injury per day: if that day already has one, only the fields you pass change (pain always), so a late correction keeps the rest. trend 'gone' also marks the injury healed on that date.",
    inputSchema: {
      type: "object",
      properties: {
        injury_id: { type: "integer", description: "From get_overview's active_injuries" },
        date: { ...dateSchema, description: "The day the pain is for (YYYY-MM-DD). Defaults to today in the climber's timezone." },
        pain: { type: "integer", minimum: 0, maximum: 10, description: "0 none .. 10 worst" },
        trend: { type: "string", enum: INJURY_TRENDS, description: "Compared with the day before" },
        stiffness: { type: "boolean", description: "Morning stiffness" },
        red_flags: { type: "array", items: { type: "string", enum: RED_FLAGS }, description: "Empty list clears them" },
        note: { type: "string" },
      },
      required: ["injury_id", "pain"],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    run: async (a, env) => {
      const today = await todayFor(env);
      const date = checkUpdateDate(a.date ?? today, today);
      const update = parseInjuryUpdate(a);
      await addInjuryUpdate(env.DB, date, update, true);
      return { saved: { ...update, date } };
    },
  },
  {
    name: "resolve_injury",
    description:
      "Mark an injury healed on resolved_on (defaults to today in the climber's timezone; may be in the past, not before started_on, not in the future). Pass resolved_on: null to reopen a healed injury that came back.",
    inputSchema: {
      type: "object",
      properties: {
        injury_id: { type: "integer" },
        resolved_on: { ...nullableDate, description: "YYYY-MM-DD, or null to reopen" },
      },
      required: ["injury_id"],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    run: async (a, env) => {
      const id = a.injury_id;
      if (!Number.isInteger(id)) throw new Error("injury_id is required (integer)");
      if (a.resolved_on === null) {
        await reopenInjury(env.DB, id);
        return { injury_id: id, reopened: true };
      }
      const today = await todayFor(env);
      const date = a.resolved_on ?? today;
      await resolveInjury(env.DB, id, date, today);
      return { injury_id: id, resolved_on: date };
    },
  },
  {
    name: "update_session",
    description:
      `Fix a logged session by id (ids are in get_overview's sessions). Only the fields you pass change; null clears max_grade, notes or tags (notes and tags are replaced as a whole). Tags and outdoor are only for ${TAG_TYPES.join("/")}; changing a session to another type clears its tags and sets it back to indoors. Load is recomputed from duration_min * rpe. A new date also moves the benchmark results logged with it. Returns the updated session.`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, ...schemaOf(SESSION_FIELDS) },
      required: ["id"],
    },
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async (a, env) => {
      const id = sessionId(a.id);
      const row = await updateSessionFields(env.DB, id, await checkedSessionPatch(env.DB, id, a));
      if (!row) throw new NotFound(`Session ${id} not found`);
      return row;
    },
  },
  {
    name: "delete_session",
    description:
      "Delete a logged session by id, e.g. a duplicate. Returns the deleted row (log it again with log_session if it was a mistake). Injuries and benchmark results linked to it stay but lose the link. Prefer update_session to fix values.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async (a, env) => {
      const id = sessionId(a.id);
      const row = await deleteSession(env.DB, id);
      if (!row) throw new NotFound(`Session ${id} not found`);
      return { deleted: row };
    },
  },
];
