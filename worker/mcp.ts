// A minimal, stateless MCP server (Streamable HTTP transport, JSON responses only).
// Claude Code and claude.ai custom connectors both speak this, so no SDK is needed.

import { CHECKIN_FIELDS, checkinPatch, upsertCheckinPartial } from "./checkins";
import { type Env, type PlanEntry, addCoachNote, getProfile, insertSession, overview, resolveGym, setPlan, updateProfile } from "./db";
import { isIsoDate } from "./injury-dates";
import { ISSUE_LABELS, PRIORITIES, PRIORITY_TEXT, createIssue, githubEnabled, listIssues, listMilestones } from "./github";
import { type Tool, dateSchema, today } from "./mcp-common";
import { CHECKLIST_TOOL, InvalidParams, d1ChecklistLoader, handlePromptRequest } from "./mcp-prompts";
import { COACH_TOOLS } from "./mcp-coach";
import { WRITE_TOOLS } from "./mcp-writes";
import { schemaOf } from "./partial";
import { profileInjuryWarnings, rejectedProfileWarning, splitProfileUpdate } from "./profile-injury";
import { annotateSchema } from "./schema-docs";
import { GYM_MESSAGE, isGymInput } from "./gyms";
import { parseGrade } from "./grades";
import { OUTDOOR_TYPES, SESSION_TYPES, outdoorColumn, outdoorError } from "./sessions";
import { TYPE_GROUPS } from "./typeGroups";
import {
  FINGER_WEIGHT_MAX,
  FINGER_WEIGHT_MIN,
  SESSION_TAGS,
  TAG_FINGER_WEIGHTS,
  TAG_TYPES,
  TYPE_FINGER_WEIGHTS,
  fingerWeight,
  tagsColumn,
  tagsError,
} from "./tags";

// Groups keys by weight, highest first, e.g. "board x1.2, boulder/hangboard x1, lead x0.7".
const weightsText = (weights: Record<string, number>) =>
  [...new Set(Object.values(weights))]
    .sort((a, b) => b - a)
    .map((w) => `${Object.keys(weights).filter((k) => weights[k] === w).join("/")} x${w}`)
    .join(", ");
const WEIGHTS_TEXT = weightsText(TAG_FINGER_WEIGHTS);
const TYPE_WEIGHTS_TEXT = weightsText(TYPE_FINGER_WEIGHTS);
const GROUPS_TEXT = TYPE_GROUPS.map((g) => `${g.key} = ${g.types.join("/")}`).join(", ");
const CLIMBING_TEXT = OUTDOOR_TYPES.join("/");

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `This server is a climber's personal training log (sessions, morning check-ins, hangboard
timer logs, injuries, a training plan, profile/goals). The data is entered from a phone app with as few taps
as possible, so values are rough.

When asked how to train today: call get_overview first. If it returns warnings, sort those out with the
climber first (they are data problems, e.g. an injury described in the profile but not tracked). Weigh, in
order: active injuries (pain trend matters more than a single value), last night's sleep and how they feel,
alcohol in the last 1-2 days, training load
(ratio_total / ratio_finger well above ~1.3 means a fast ramp; fingers adapt slower than muscle), consecutive
hard days, and what the plan says for today. get_overview's readiness (green/amber/red with reasons) is the
same call the app shows under the check-in; start from it and agree with it unless you see a reason not to
(then say why). It never blocks anything. Give a concrete session (warm-up, main block with sets/grades/
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
top, that counts timer runs twice. A hang log with warmup = 1 was a warm-up for that day's climbing: it is part
of that session, not a separate training session, and adds no load (don't log a session for it). Other hang
logs without that session are from an older app version.

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
type first, then a similar one (boulder/board/lead/toprope; strength/hangboard), else any free entry that day. Same
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

Style tags: ${TAG_TYPES.join("/")} sessions may carry optional tags (sessions.tags, comma-separated: ${SESSION_TAGS.join(", ")}).
Untagged is common and means "unknown", not "easy". Finger load in training_load is weighted per session by
type x tag, clamped to ${FINGER_WEIGHT_MIN}-${FINGER_WEIGHT_MAX}. Type: ${TYPE_WEIGHTS_TEXT}. Tag: ${WEIGHTS_TEXT};
a session with several tags takes the highest tag weight (so slab+crimpy counts as crimpy), untagged = x1, and a
tag naming the session's own type (board on a board session) adds nothing. E.g. board+crimpy = x${fingerWeight("board", "crimpy")}, lead+slab = x${fingerWeight("lead", "slab")}.
last7.finger, prev28_weekly_avg.finger, weeks[].finger and ratio_finger use the weighted value; the *.finger_raw
fields are the plain unweighted sums. finger_load_day_before on injury updates is unweighted. Use the tags to check
style rules such as "avoid small crimps", and pass tags to log_session / update_session when the climber describes the style.

Indoor/outdoor: ${CLIMBING_TEXT} sessions carry sessions.outdoor (1 = outdoors at a crag or boulders, 0 = indoors,
the default; other types are always 0). lead and toprope are separate types (older rope sessions are all lead,
whatever they were). Outdoor days usually mean longer sessions with more rest, so a long outdoor session at a
moderate effort is normal; mix.*.outdoor_minutes in get_overview shows how much of each group's time was
outdoors. Pass outdoor: true to log_session / update_session when the climber says they climbed outside.

Gyms: sessions.gym names where a session was done (free text). get_overview's gyms lists the names used so far;
when the climber mentions a gym, pass that exact name as gym to log_session / update_session (the server also
maps different case or spacing onto the stored spelling). Leave it out when not said.

Use set_plan to write or rewrite the plan (one or more entries per date; existing entries on those dates are
replaced, which also drops their status overrides and the sessions pinned to them; statuses are then derived
again against the new entries, so already-logged days keep showing what happened). Plan entries carry source:
'coach' (written by set_plan) or 'app' (added by hand). With keep_app_entries: true, set_plan replaces only
coach entries without a status picked by hand.

Daily coach review: a scheduled run (the daily_review prompt) calls start_daily_review and follows its
instructions. Questions for the climber go through ask_question (shown on the app's Coach tab, answered with
a tap); get_overview's coach.answered_questions are answers not used yet: use them (lasting facts to the
profile), then close_questions. coach.last_run is the last review. coach.climbing_days is the climber's latest
pick of climbing days (from the weekly question or the app's "Plan my climbing days"): plan climbing on those
days when you write the plan. In a normal chat you may use the same
questions, but ask the climber directly when they are there.

When a planned day includes tests (max pull-ups, max hang, plank, hardest flash, a timed run...), put them
in that entry's expected_benchmarks as {name, unit}, not only in details: the app then shows an input per
test when the climber logs that day's session, the results land in benchmarks, and the entry counts as a
test day for plan_conflicts. Reuse an existing name and unit exactly (get_overview's benchmark_names lists
those already in use) so results line up over time; for a new test pick a short, specific name ('Max hang
20mm 10s', 'Max pull-ups') and a unit you will keep using ('kg added', 'reps', 's', 'min:s', 'grade').
get_overview's missing_benchmarks_last_7_days lists planned tests from the last 7 days with no result yet (a
result logged on a later day counts as done): offer to reschedule them into an upcoming day with set_plan.

Voice-note logging: when the climber says "morning log" or "training log" (or picks the morning_log /
training_log prompt), call get_log_checklist (kind morning or training; for training pass the date if they
gave one) and reply with only its checklist, exactly as written: it is the same every time so they can read
it while recording. Then they send a voice note. Reply with a short summary of what you understood, ask only
about missed REQUIRED items (the tool's text says which), and save after they confirm. Map spoken values onto
the scales: "slept like rubbish" = sleep_quality 1, "fine" = 2, "great" = 3; "knackered"/"wrecked" ~ feeling
1-2, "fresh" = 5; "a couple of beers" = 2 drinks, "none" = 0; "barely any protein" = low; "easy" ~ effort 3-4,
"hard" ~ 7-8, "all out" = 9-10. Never invent values for items not mentioned (no stiffness or red flag unless
they say so). Save with partial writes: upsert_checkin with only the fields heard; add_injury_update per
injury mentioned (injury_id from the tool's text; trend, stiffness, red_flags when said); log_session with
the date, plan_id of the planned entry they confirm (the tool lists the entries for that date; if they name
another date, call get_log_checklist again with it to get that day's plan_id and planned tests), tags when
they describe the style and outdoor: true when they climbed outside (indoors when not said); log_benchmark for each test result, with the session date and the planned name and
unit. A new tweak or injury: report_injury with started_on = the session date and session_id = the logged
session's id.

Grades: sessions.max_grade is free text in whatever system the gym uses. get_overview adds a parsed grade to
each session it can read (discipline boulder or route, the system it was written in, a ladder index and the same
grade in each system of that discipline: Font and V for boulders, French and YDS for routes) and grade_progress
(per discipline: the hardest grade in the last 28 days, the 28 before and ever, and the change in ladder steps).
Compare and track grades through grade.index and grade_progress, not the raw text: "6C" and "V5" are about the same, and
"6c" on a lead session is a French route grade. Never compare or convert across boulder and route, the scales
don't map onto each other. A session with max_grade but no grade has text that isn't a grade (e.g. "project").
convert_grade converts a single grade, e.g. to write the plan in the system the climber's gym uses.

Use query for ad-hoc analysis (read-only SQL, SQLite dialect; call get_schema first: its column
comments, with units and scales, come from the server code, since the database itself keeps none).

If report_issue is available, it files issues on the app's own GitHub repo: feature ideas and bugs about
this app, never training notes or personal data (the repo is public). Call list_issues first to avoid
duplicates, and write the issue so a developer can act on it. Give it a priority (${PRIORITY_TEXT}) and a
milestone when one fits; it is added to the roadmap issue. App feedback the climber typed in the app arrives
in start_daily_review's changes.new_feedback, with the priority the climber picked (null = not picked, choose
one); record what you did with each one with resolve_feedback.`;

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
      `Everything needed to recommend today's training: warnings (data problems to sort out first, if any), readiness (green/amber/red with reasons, from check-in, hard days, load vs baseline and plan, injury trend; the same call the app shows), profile/goals, active injuries with daily updates (pain, trend, stiffness, red flags, load the day before), recently resolved injuries, training load stats (ratios carry baseline_status: building / partial / ok; finger load weighted by session type and style tags, finger_raw unweighted), mix (minutes, load, session count and outdoor_minutes per type group for the last 7 and last 28 days, so you can spot e.g. one rope session in three weeks; groups: ${GROUPS_TEXT}), recent check-ins (sleep, feeling, alcohol, protein), sessions (with optional style tags, outdoor 0/1, gym, and grade: max_grade parsed into discipline, system, ladder index and its equivalents, when readable), grade_progress (per discipline boulder/route: hardest grade in the last 28 days vs the 28 before vs ever, with dates and change in ladder steps), gyms (names used so far with session count and last use; reuse these exact names), hangboard logs, plan for the past N days and next 9 (each entry with status and expected_benchmarks), plan adherence per day, week-so-far counts, week_summary (this week Monday to today, the same numbers as the app's weekly card: average sleep hours and quality, total drinks from check-ins dated this week, sessions logged and planned vs done, weighted finger load this week vs the usual weekly average with its baseline_status, rope vs boulder minutes and share), plan_conflicts, recent coach notes and benchmarks, benchmark_names already in use, missing_benchmarks_last_7_days (planned tests with no result yet), and coach (open_questions, answered_questions not used yet, last_run of the daily review, climbing_days: the days the climber last picked to climb, as dates, or null).`,
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
    name: "convert_grade",
    description:
      "Convert a climbing grade within its discipline: boulder Font <-> V, route French <-> YDS (never boulder <-> route). Returns the discipline, the system it was written in, its ladder index (for comparing grades; .5 = between two rungs) and the grade in each system. Slash grades (6b/6b+, V4/5) are read as their midpoint.",
    inputSchema: {
      type: "object",
      properties: {
        grade: { type: "string", description: "e.g. '6C', 'V5', '7a+', '5.11b', '6b/6b+'" },
        session_type: {
          type: "string",
          enum: [...SESSION_TYPES, "route"],
          description:
            "Session type or 'route': tells Font from French for grades like '6c' (boulder/board = Font, lead/toprope/route = French). Without it an uppercase letter is Font, lowercase French.",
        },
      },
      required: ["grade"],
    },
    annotations: { readOnlyHint: true },
    run: async (a) => {
      const grade = parseGrade(a.grade, a.session_type);
      if (grade) return { input: a.grade, ...grade };
      return `Can't read ${JSON.stringify(a.grade ?? "")} as a grade. Understood: Font 3-9A (e.g. 6C+), V VB-V17, French 3-9c (e.g. 7a+), YDS 5.4-5.15d (e.g. 5.11b), and slash grades of these (6b/6b+, V4/5). Number-only grades like 5+ need session_type.`;
    },
  },
  {
    name: "set_plan",
    description:
      "Write planned sessions. Existing plan entries on the dates you include are replaced (unless replace_dates is false). Use type 'rest' with intensity 'rest' for rest days. Put any tests planned for a day in expected_benchmarks, reusing names and units from get_overview's benchmark_names.",
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
              details: {
                type: "string",
                description:
                  "The actual workout as short lines, one per block, separated by newlines (the app shows each line as a bullet). Start each with a short label and a colon, e.g. 'Warm-up 15 min: easy routes'. Keep each line under ~80 characters; no prose or repeated advice.",
              },
              duration_min: { type: "integer", minimum: 1, description: "Planned length; a much shorter session counts as partial" },
              expected_benchmarks: {
                type: "array",
                maxItems: 10,
                description:
                  "Tests to do that day; the app asks for each result when the session is logged. Reuse existing benchmark names/units exactly.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "e.g. 'Max pull-ups', 'Max hang 20mm 10s'" },
                    unit: { type: "string", description: "e.g. 'reps', 'kg added', 's', 'grade'" },
                  },
                  required: ["name", "unit"],
                },
              },
            },
            required: ["date", "title"],
          },
        },
        replace_dates: { type: "boolean", default: true },
        keep_app_entries: {
          type: "boolean",
          default: false,
          description: "When replacing, keep entries the climber added by hand (source 'app') or set a status on. The daily review always passes true.",
        },
      },
      required: ["entries"],
    },
    run: async (a, env) => {
      const entries = a.entries as PlanEntry[];
      await setPlan(env.DB, entries, a.replace_dates ?? true, { source: "coach", keepAppEntries: a.keep_app_entries === true });
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
    description: "Save a recommendation so it shows on the app's Coach tab. Write 2-4 short lines, one point each, separated by newlines: the app shows each line as a bullet.",
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
      "Log a completed training session. Load is computed as duration_min * rpe. Climbing sessions can be marked outdoor (default indoors). To fix one that is already logged use update_session.",
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
        tags: {
          type: "array",
          items: { type: "string", enum: SESSION_TAGS },
          description: `Optional style tags, only for ${TAG_TYPES.join(", ")}. Weight finger load (see instructions).`,
        },
        outdoor: {
          type: "boolean",
          default: false,
          description: `Climbed outdoors (crag, boulders); only for ${OUTDOOR_TYPES.join(", ")}. Default false = indoors.`,
        },
        gym: {
          type: "string",
          description: "Gym the session was at, when the climber says. Reuse the exact name from get_overview's gyms; a new name is fine for a new gym.",
        },
      },
      required: ["type", "duration_min", "rpe"],
    },
    run: async (a, env) => {
      const error = tagsError(a.tags, a.type) ?? outdoorError(a.outdoor, a.type);
      if (error) throw new Error(error);
      if (a.gym !== undefined && !isGymInput(a.gym)) throw new Error(GYM_MESSAGE);
      const s = {
        ...a,
        tags: tagsColumn(a.tags),
        outdoor: outdoorColumn(a.outdoor),
        gym: await resolveGym(env.DB, a.gym),
        date: await today(env, a.date),
      };
      return { id: await insertSession(env.DB, s) };
    },
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
  ...COACH_TOOLS,
  CHECKLIST_TOOL,
  {
    name: "list_issues",
    description: "List issues on the app's GitHub repo (roadmap, ideas, bugs) and its open milestones. Use before report_issue to avoid duplicates.",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", enum: ["open", "closed", "all"], default: "open" } },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    enabled: githubEnabled,
    run: async (a, env) => {
      const [issues, milestones] = await Promise.all([listIssues(env, a.state ?? "open"), listMilestones(env)]);
      return { issues, milestones };
    },
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
        priority: { type: "string", enum: PRIORITIES, description: `Adds a priority label: ${PRIORITY_TEXT}. P2 also adds the backlog label and lists it under the roadmap's backlog section` },
        milestone: { type: "string", description: "Title of an open milestone (from list_issues), e.g. for when it should be done" },
        add_to_roadmap: { type: "boolean", default: true, description: "List it in the pinned roadmap issue, under its milestone's section" },
      },
      required: ["title", "body"],
    },
    annotations: { openWorldHint: true },
    enabled: githubEnabled,
    run: async (a, env) =>
      createIssue(env, a.title, a.body, { labels: a.labels, priority: a.priority, milestone: a.milestone, addToRoadmap: a.add_to_roadmap }),
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
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
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
    case "prompts/list":
    case "prompts/get":
      try {
        return reply(await handlePromptRequest(msg.method, msg.params, d1ChecklistLoader(env)));
      } catch (e) {
        if (e instanceof InvalidParams) return fail(-32602, e.message);
        return fail(-32603, (e as Error).message);
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
