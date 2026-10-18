// A minimal, stateless MCP server (Streamable HTTP transport, JSON responses only).
// Claude Code and claude.ai custom connectors both speak this, so no SDK is needed.

import { CHECKIN_FIELDS, checkinPatch, upsertCheckinPartial } from "./checkins";
import { type Env, type PlanEntry, addCoachNote, getProfile, insertSession, overview, setPlan, updateProfile } from "./db";
import { isIsoDate } from "./injury-dates";
import { ISSUE_LABELS, createIssue, githubEnabled, listIssues } from "./github";
import { type Tool, dateSchema, today } from "./mcp-common";
import { WRITE_TOOLS } from "./mcp-writes";
import { schemaOf } from "./partial";
import { profileInjuryWarnings, rejectedProfileWarning, splitProfileUpdate } from "./profile-injury";
import { annotateSchema } from "./schema-docs";
import { SESSION_TYPES } from "./sessions";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `This server is a climber's personal training log (sessions, morning check-ins, hangboard
timer logs, injuries, a training plan, profile/goals). The data is entered from a phone app with as few taps
as possible, so values are rough.

When asked how to train today: call get_overview first. If it returns warnings, sort those out with the
climber first (they are data problems, e.g. an injury described in the profile but not tracked). Weigh, in
order: active injuries (pain trend matters more than a single value), last night's sleep and how they feel,
alcohol in the last 1-2 days, training load
(ratio_total / ratio_finger well above ~1.3 means a fast ramp; fingers adapt slower than muscle), consecutive
hard days, and what the plan says for today. Give a concrete session (warm-up, main block with sets/grades/
times, what to avoid), not general advice. Then offer to save it with add_coach_note so it appears in the app.

Injuries live only in the injuries / injury_updates tables, never in the profile (update_profile won't save
injury keys such as current_injury; remove an old one with update_profile {"current_injury": null} once it is
tracked). The app's morning injury check and the pain trend only exist for rows in injuries. When the climber
mentions a new tweak or injury, record it with report_injury (started_on can be in the past; with resolved_on
an injury that has already healed is recorded in one step; session_id links the session it happened in).
Record pain they tell you about with add_injury_update (one per injury per day, partial like check-ins),
and mark one healed with resolve_injury (resolved_on: null reopens it). Put injury-specific training rules
in the injury's description or the plan.

The morning check-in records, per active injury, pain 0-10, trend vs the day before (better/same/
worse/gone), morning stiffness and red flags (swelling, numbness, night_pain). Each update carries
load_day_before / finger_load_day_before: infer from these whether the previous day's session aggravated it
(e.g. "worse" after a hard finger day) and adjust; don't ask the climber. An injury's session_* fields are the
session it was logged from, if any. Injuries can be entered after the fact (backdated started_on, sometimes
already resolved, often from a pain word in a session note), so check started_on rather than assuming it is
new. Keep injury guidance to training-plan changes: unload or avoid the affected area, substitute exercises,
cap intensity. No medical-referral advice. Any red flag: fully unload the affected area until no red flags
have been reported for a few days. Recently resolved (trend "gone"): taper back to full intensity over
several sessions rather than jumping straight back.

Load = duration_min * rpe, from sessions only. Each hangboard timer run writes a hang_logs row (the detail:
preset, grip, edge, hangs done) plus a 'hangboard' session carrying its load, with a default rpe the climber
may have adjusted (its client_id is the hang log's client_id + ':session'). Don't add hang_logs to load on
top, that counts timer runs twice. A hang log without that session is from an older app version or was a
warm-up the climber chose not to count.

Check-in scales: sleep_quality 1-3, feeling 1-5 (5 = fresh), drinks = alcoholic drinks the day before,
protein = rough low/ok/high for the day before.

Load ratios need history: load.history_days counts days since the first session (inclusive). baseline_status
"building" (< 14 days) means no ratio yet; "partial" (14-27) means the previous-weeks average covers only the
days that exist (scaled to a week) and ratio_provisional is true, so treat it as a rough guide; "ok" (28+) is
the normal 7-day vs previous-28-day comparison.

Writing: anything the climber tells you can be saved, and logging is often done a day or two late, so
always pass the date they mean (dates default to today in the climber's timezone). upsert_checkin,
update_session and add_injury_update are partial: pass only what you were told; omitted fields keep their
value and null clears one. Fix a wrong session with update_session, or delete_session for a duplicate,
instead of logging it again (session ids are in get_overview). Never invent values for things not mentioned.

Plan vs actual: every plan entry has a status, derived when read from the sessions logged (so a session
logged a day or two late still turns "skipped" into "done"). Sessions match the entries on their date: same
type first, then a similar one (boulder/board/lead; strength/hangboard), else any free entry that day. Same
type (or an entry with no type) = done, or partial if under 60% of the entry's duration_min; a different type
= swapped; a session on a rest day makes the rest day swapped; nothing logged once the day is over = skipped;
today and later = planned. auto_status is the derived one; the climber can override it in the app. A
session's plan_id pins it to an entry (log_session / update_session plan_id, e.g. a planned session done
on another day; null unpins);
otherwise matching is automatic. get_overview returns plan_adherence (per day: entries, status, matched
session_id, unplanned sessions), plan_week_so_far and plan_conflicts: training on a rest day, a hard day
(effort 8+ or load 600+) not planned hard right before a planned hard day, a strength/test day skipped or
swapped. Each conflict names the upcoming entry it affects (flag_date). When plan_conflicts is not empty,
point them out and offer a set_plan rewrite of the rest of the week (ask first; the app never rewrites the
plan itself). Fill duration_min in set_plan when the session length matters, so partial can be detected.

Use set_plan to write or rewrite the plan (one or more entries per date; existing entries on those dates are
replaced, which also drops their status overrides and the sessions pinned to them; statuses are then derived
again against the new entries, so already-logged days keep showing what happened). Use query for ad-hoc analysis (read-only SQL, SQLite dialect; call get_schema first: its column
comments, with units and scales, come from the server code, since the database itself keeps none).

If report_issue is available, it files issues on the app's own GitHub repo: feature ideas and bugs about
this app, never training notes or personal data (the repo is public). Call list_issues first to avoid
duplicates, and write the issue so a developer can act on it.`;

function readOnlySql(sql: string): string {
  const s = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(s)) throw new Error("Only SELECT / WITH queries are allowed.");
  if (s.includes(";")) throw new Error("Only a single statement is allowed.");
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(s)) {
    throw new Error("Query looks like it modifies data; only reads are allowed.");
  }
  return s;
}

const TOOLS: Tool[] = [
  {
    name: "get_overview",
    description:
      "Everything needed to recommend today's training: warnings (data problems to sort out first, if any), profile/goals, active injuries with daily updates (pain, trend, stiffness, red flags, load the day before), recently resolved injuries, training load stats (ratios carry baseline_status: building / partial / ok), recent check-ins (sleep, feeling, alcohol, protein), sessions, hangboard logs, plan for the past N days and next 7 (each entry with status), plan adherence per day, week-so-far counts, plan_conflicts, recent coach notes and benchmarks.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90, default: 14, description: "How many days of history" },
        date: { ...dateSchema, description: "Treat this as today (defaults to today in the climber's timezone)" },
      },
    },
    annotations: { readOnlyHint: true },
    run: async (a, env) => {
      const o = await overview(env.DB, await today(env, a.date), a.days ?? 14);
      const warnings = profileInjuryWarnings(o.profile, o.active_injuries.length);
      return warnings.length ? { warnings, ...o } : o;
    },
  },
  {
    name: "get_schema",
    description:
      "The database schema: CREATE statements with a comment per column (meaning, units, scales; maintained in the server code, since D1 strips SQL comments). Use before writing SQL for `query`.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_a, env) => {
      const { results } = await env.DB.prepare(
        "SELECT sql FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND sql IS NOT NULL AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'",
      ).all<{ sql: string }>();
      return annotateSchema(results.map((r) => r.sql));
    },
  },
  {
    name: "query",
    description: "Run a read-only SQL query (SQLite) against the training database. Results are capped at 500 rows.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "A single SELECT or WITH statement" } },
      required: ["sql"],
    },
    annotations: { readOnlyHint: true },
    run: async (a, env) => {
      const { results } = await env.DB.prepare(readOnlySql(a.sql)).all();
      return results.length > 500 ? { truncated: true, rows: results.slice(0, 500) } : results;
    },
  },
  {
    name: "set_plan",
    description:
      "Write planned sessions. Existing plan entries on the dates you include are replaced (unless replace_dates is false). Use type 'rest' with intensity 'rest' for rest days.",
    inputSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: dateSchema,
              title: { type: "string", description: "Short, e.g. 'Limit bouldering' or 'Rest'" },
              type: { type: "string", enum: [...SESSION_TYPES, "rest"] },
              intensity: { type: "string", enum: ["rest", "easy", "moderate", "hard"] },
              details: { type: "string", description: "The actual workout: warm-up, sets, grades, times" },
              duration_min: { type: "integer", minimum: 1, description: "Planned length; a much shorter session counts as partial" },
            },
            required: ["date", "title"],
          },
        },
        replace_dates: { type: "boolean", default: true },
      },
      required: ["entries"],
    },
    run: async (a, env) => {
      const entries = a.entries as PlanEntry[];
      await setPlan(env.DB, entries, a.replace_dates ?? true);
      return { saved: entries.length };
    },
  },
  {
    name: "delete_plan",
    description: "Delete all plan entries between two dates (inclusive).",
    inputSchema: { type: "object", properties: { from: dateSchema, to: dateSchema }, required: ["from", "to"] },
    annotations: { destructiveHint: true },
    run: async (a, env) => {
      const r = await env.DB.prepare("DELETE FROM plan WHERE date BETWEEN ? AND ?").bind(a.from, a.to).run();
      return { deleted: r.meta.changes };
    },
  },
  {
    name: "add_coach_note",
    description: "Save a recommendation so it shows on the app's Today screen. Keep it short and scannable on a phone.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, date: { ...dateSchema, description: "Defaults to today" } },
      required: ["text"],
    },
    run: async (a, env) => ({ id: await addCoachNote(env.DB, await today(env, a.date), a.text) }),
  },
  {
    name: "log_session",
    description:
      "Log a completed training session. Load is computed as duration_min * rpe. To fix one that is already logged use update_session.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateSchema,
        type: { type: "string", enum: SESSION_TYPES },
        duration_min: { type: "integer", minimum: 1 },
        rpe: { type: "integer", minimum: 1, maximum: 10, description: "Effort 1-10" },
        max_grade: { type: "string" },
        notes: { type: "string" },
        plan_id: {
          type: "integer",
          description: "Only when this was a specific planned entry done on a different day or not auto-matched; otherwise sessions match the plan by date and type",
        },
      },
      required: ["type", "duration_min", "rpe"],
    },
    run: async (a, env) => ({ id: await insertSession(env.DB, { ...a, date: await today(env, a.date) }) }),
  },
  {
    name: "upsert_checkin",
    description:
      "Create or correct the morning check-in for a date. Partial: only the fields you pass are changed, the others keep their value (null clears one), so a late correction like 'I also had 3 beers' doesn't wipe the sleep and feeling logged in the app. Returns the saved check-in.",
    inputSchema: {
      type: "object",
      properties: {
        date: { ...dateSchema, description: "The morning it is for (YYYY-MM-DD). Defaults to today in the climber's timezone; logging is often a day or two late, so pass it." },
        ...schemaOf(CHECKIN_FIELDS),
      },
    },
    annotations: { idempotentHint: true },
    run: async (a, env) => {
      if (a.date !== undefined && !isIsoDate(a.date)) throw new Error("date must be YYYY-MM-DD");
      const patch = checkinPatch(a);
      return upsertCheckinPartial(env.DB, await today(env, a.date), patch);
    },
  },
  {
    name: "log_benchmark",
    description: "Record a benchmark/test result, e.g. max hang on 20mm, max pull-ups, project grade.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateSchema,
        name: { type: "string" },
        value: { type: "string" },
        unit: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name", "value"],
    },
    run: async (a, env) => {
      const row = await env.DB.prepare(
        "INSERT INTO benchmarks (date, name, value, unit, notes) VALUES (?, ?, ?, ?, ?) RETURNING id",
      )
        .bind(await today(env, a.date), a.name, String(a.value), a.unit ?? null, a.notes ?? null)
        .first<{ id: number }>();
      return { id: row!.id };
    },
  },
  {
    name: "update_profile",
    description:
      "Set facts about the climber used for planning, e.g. goal, trip_date, trip_details, level, weekly_availability, gym_setup, timezone. Set a value to null to remove it. Not for injuries: injury keys (current_injury, injury, injuries, pain, ...) are not saved, use report_injury / add_injury_update / resolve_injury. Removing an old injury key (null) is allowed.",
    inputSchema: {
      type: "object",
      properties: { values: { type: "object", additionalProperties: { type: ["string", "null"] } } },
      required: ["values"],
    },
    run: async (a, env) => {
      if (typeof a.values !== "object" || a.values === null) throw new Error("values must be an object");
      const { allowed, rejected } = splitProfileUpdate(a.values);
      await updateProfile(env.DB, allowed);
      const profile = await getProfile(env.DB);
      return rejected.length ? { profile, warnings: [rejectedProfileWarning(rejected)] } : { profile };
    },
  },
  ...WRITE_TOOLS,
  {
    name: "list_issues",
    description: "List issues on the app's GitHub repo (roadmap, ideas, bugs). Use before report_issue to avoid duplicates.",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", enum: ["open", "closed", "all"], default: "open" } },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    enabled: githubEnabled,
    run: async (a, env) => listIssues(env, a.state ?? "open"),
  },
  {
    name: "report_issue",
    description:
      "File a feature idea or bug about this app as an issue on its PUBLIC GitHub repo. Never include training data, health details or other personal information.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short and specific, e.g. 'Rest timer should vibrate on Android'" },
        body: { type: "string", description: "Markdown: what and why, and where in the app if known" },
        labels: { type: "array", items: { type: "string", enum: ISSUE_LABELS } },
      },
      required: ["title", "body"],
    },
    annotations: { openWorldHint: true },
    enabled: githubEnabled,
    run: async (a, env) => createIssue(env, a.title, a.body, a.labels),
  },
];

const tools = (env: Env) => TOOLS.filter((t) => !t.enabled || t.enabled(env));

type JsonRpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

async function handleMessage(msg: JsonRpc, env: Env): Promise<object | null> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  if (!isRequest) return null; // notifications and client responses need no reply
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "climbing-coach", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: tools(env).map(({ run: _run, enabled: _enabled, ...t }) => t) });
    case "tools/call": {
      const tool = tools(env).find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const result = await tool.run(msg.params?.arguments ?? {}, env);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return reply({ content: [{ type: "text", text }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  let body: JsonRpc | JsonRpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(messages.map((m) => handleMessage(m, env)))).filter((r) => r !== null);
  if (replies.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}
