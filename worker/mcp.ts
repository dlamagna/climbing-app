// A minimal, stateless MCP server (Streamable HTTP transport, JSON responses only).
// Claude Code and claude.ai custom connectors both speak this, so no SDK is needed.

import {
  type Env,
  type PlanEntry,
  addCoachNote,
  getProfile,
  insertSession,
  overview,
  setPlan,
  todayIn,
  updateProfile,
  upsertCheckin,
} from "./db";
import { ISSUE_LABELS, createIssue, githubEnabled, listIssues } from "./github";
import { annotateSchema } from "./schema-docs";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `This server is a climber's personal training log (sessions, morning check-ins, hangboard
timer logs, injuries, a training plan, profile/goals). The data is entered from a phone app with as few taps
as possible, so values are rough.

When asked how to train today: call get_overview first. Weigh, in order: active injuries (pain trend matters
more than a single value), last night's sleep and how they feel, alcohol in the last 1-2 days, training load
(ratio_total / ratio_finger well above ~1.3 means a fast ramp; fingers adapt slower than muscle), consecutive
hard days, and what the plan says for today. Give a concrete session (warm-up, main block with sets/grades/
times, what to avoid), not general advice. Then offer to save it with add_coach_note so it appears in the app.

Injuries: the morning check-in records, per active injury, pain 0-10, trend vs the day before (better/same/
worse/gone), morning stiffness and red flags (swelling, numbness, night_pain). Each update carries
load_day_before / finger_load_day_before: infer from these whether the previous day's session aggravated it
(e.g. "worse" after a hard finger day) and adjust; don't ask the climber. An injury's session_* fields are the
session it was logged from, if any. Injuries can be entered after the fact (backdated started_on, sometimes
already resolved, often from a pain word in a session note), so check started_on rather than assuming it is
new. Keep injury guidance to training-plan changes: unload or avoid the affected area, substitute exercises,
cap intensity. No medical-referral advice. Any red flag: fully unload the affected area until no red flags
have been reported for a few days. Recently resolved (trend "gone"): taper back to full intensity over
several sessions rather than jumping straight back.

Load = duration_min * rpe. Check-in scales: sleep_quality 1-3, feeling 1-5 (5 = fresh), drinks = alcoholic
drinks the day before, protein = rough low/ok/high for the day before.

Load ratios need history: load.history_days counts days since the first session (inclusive). baseline_status
"building" (< 14 days) means no ratio yet; "partial" (14-27) means the previous-weeks average covers only the
days that exist (scaled to a week) and ratio_provisional is true, so treat it as a rough guide; "ok" (28+) is
the normal 7-day vs previous-28-day comparison.

Use set_plan to write or rewrite the plan (one or more entries per date; existing entries on those dates are
replaced). Use query for ad-hoc analysis (read-only SQL, SQLite dialect; call get_schema first: its column
comments, with units and scales, come from the server code, since the database itself keeps none).

If report_issue is available, it files issues on the app's own GitHub repo: feature ideas and bugs about
this app, never training notes or personal data (the repo is public). Call list_issues first to avoid
duplicates, and write the issue so a developer can act on it.`;

const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" };
const SESSION_TYPES = ["boulder", "board", "lead", "hangboard", "strength", "cardio", "mobility", "other"];

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  enabled?: (env: Env) => boolean; // hidden from tools/list when false
  run: (args: any, env: Env) => Promise<unknown>;
}

async function today(env: Env, date?: string) {
  if (date) return date;
  const profile = await getProfile(env.DB);
  return todayIn(profile.timezone);
}

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
      "Everything needed to recommend today's training: profile/goals, active injuries with daily updates (pain, trend, stiffness, red flags, load the day before), recently resolved injuries, training load stats (ratios carry baseline_status: building / partial / ok), recent check-ins (sleep, feeling, alcohol, protein), sessions, hangboard logs, plan for the past N days and next 7, recent coach notes and benchmarks.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90, default: 14, description: "How many days of history" },
        date: { ...dateSchema, description: "Treat this as today (defaults to today in the climber's timezone)" },
      },
    },
    annotations: { readOnlyHint: true },
    run: async (a, env) => overview(env.DB, await today(env, a.date), a.days ?? 14),
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
    description: "Log a completed training session. Load is computed as duration_min * rpe.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateSchema,
        type: { type: "string", enum: SESSION_TYPES },
        duration_min: { type: "integer", minimum: 1 },
        rpe: { type: "integer", minimum: 1, maximum: 10, description: "Effort 1-10" },
        max_grade: { type: "string" },
        notes: { type: "string" },
      },
      required: ["type", "duration_min", "rpe"],
    },
    run: async (a, env) => ({ id: await insertSession(env.DB, { ...a, date: await today(env, a.date) }) }),
  },
  {
    name: "upsert_checkin",
    description: "Create or overwrite the morning check-in for a date. Omitted fields are cleared.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateSchema,
        sleep_hours: { type: "number" },
        sleep_quality: { type: "integer", minimum: 1, maximum: 3 },
        feeling: { type: "integer", minimum: 1, maximum: 5 },
        drinks: { type: "integer", minimum: 0 },
        protein: { type: "string", enum: ["low", "ok", "high"] },
        weight_kg: { type: "number" },
        note: { type: "string" },
      },
    },
    run: async (a, env) => {
      const date = await today(env, a.date);
      await upsertCheckin(env.DB, date, a);
      return { saved: date };
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
      "Set facts about the climber used for planning, e.g. goal, trip_date, trip_details, level, weekly_availability, gym_setup, timezone. Set a value to null to remove it.",
    inputSchema: {
      type: "object",
      properties: { values: { type: "object", additionalProperties: { type: ["string", "null"] } } },
      required: ["values"],
    },
    run: async (a, env) => {
      await updateProfile(env.DB, a.values);
      return getProfile(env.DB);
    },
  },
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
