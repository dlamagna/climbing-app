// Documentation for every table and column, returned by the MCP get_schema tool.
//
// D1 strips SQL comments when it applies migrations, so sqlite_master only holds bare CREATE statements.
// The docs live here instead and are inlined into get_schema's output as `-- comment` lines.
//
// Every new migration that adds a table or column MUST add matching COLUMN_DOCS entries (and remove
// entries for anything it drops). worker/schema-docs.test.ts applies all migrations to an in-memory
// SQLite and fails on undocumented columns and on stale entries.
//
// Conventions: dates are local calendar dates as 'YYYY-MM-DD'; timestamps are UTC ISO strings
// ('YYYY-MM-DDTHH:MM:SSZ').

export const SCHEMA_NOTES =
  "Column docs come from code (worker/schema-docs.ts) because D1 strips SQL comments. " +
  "Dates are local calendar dates 'YYYY-MM-DD'; timestamps (created_at, updated_at) are UTC ISO strings. " +
  "Training load = duration_min * rpe.";

const CREATED_AT = "when the row was inserted (UTC timestamp)";
const CLIENT_ID =
  "random id sent by the phone for idempotent offline replays; NULL for older rows and rows written via MCP";

export const TABLE_DOCS: Record<string, string> = {
  checkins: "one morning check-in per day; values are rough, entered with a few taps",
  sessions: "completed training sessions",
  hang_logs: "written automatically by the hangboard timer, one row per timer run",
  timer_presets: "hangboard timer presets shown in the app",
  injuries: "injuries; active while resolved_on is NULL",
  injury_updates: "daily follow-up for an injury, recorded from the morning check-in",
  plan: "planned sessions, usually written by Claude via MCP set_plan",
  coach_notes: "recommendations Claude writes back; shown on the app's Today screen",
  coach_runs: "one row per daily coach review run (MCP record_coach_run); the next run reviews data written after seen_through",
  app_feedback: "feedback about the app typed in the app; the daily coach review triages it into GitHub issues (MCP resolve_feedback)",
  climber_notes: "free-text notes the climber sends the coach from the app's Today screen; the daily review gets the ones written since its last run",
  coach_questions: "questions Claude asks the climber (MCP ask_question); shown on the app's Today screen until answered, skipped, expired or closed",
  benchmarks: "benchmark / test results over time",
  profile: "free-form facts about the climber as key/value pairs: goal, trip_date, level, availability, timezone... Not injuries: those are rows in injuries",
};

export const COLUMN_DOCS: Record<string, Record<string, string>> = {
  checkins: {
    date: "the morning of the check-in (one row per date)",
    sleep_hours: "hours slept last night",
    sleep_quality: "last night's sleep: 1 bad, 2 ok, 3 good",
    feeling: "1 wrecked .. 5 fresh (energy and soreness in one)",
    drinks: "alcoholic drinks the day before (5 = 5 or more)",
    protein: "protein intake the day before, rough: 'low' | 'ok' | 'high'",
    weight_kg: "body weight in kg, optional",
    note: "free text",
    updated_at: "last time the check-in was written (UTC timestamp)",
  },
  sessions: {
    id: "row id",
    date: "day of the session",
    type: "boulder | board | lead | toprope | hangboard | strength | cardio | mobility | other. Lead and top rope were one type (lead) before toprope was added, so older rope sessions are all lead",
    duration_min: "duration in minutes",
    rpe: "effort 1..10; training load = duration_min * rpe",
    max_grade: "hardest send, free text (e.g. '6C', 'V5', '7a'); get_overview adds it parsed and converted as grade (worker/grades.ts)",
    notes: "free text",
    created_at: CREATED_AT,
    client_id: CLIENT_ID,
    updated_at: "when the session was last edited after logging (UTC timestamp); NULL = never edited",
    plan_id:
      "references plan.id: pinned link to the planned entry this session was (e.g. done on another day); NULL = matched automatically by date and type at read time. Cleared when that plan entry is deleted or replaced by set_plan",
    tags: "optional style tags (boulder/board/lead/toprope only), comma-separated in this order: crimpy, open-hand, slab, vertical, overhang, board, technique, projecting, volume; NULL = untagged. Weights finger load together with the type (worker/tags.ts)",
    outdoor: "1 = climbed outdoors (crag, boulders), 0 = indoors (default; all sessions before this column existed). Only climbing types (boulder/board/lead/toprope) can be 1",
    gym: "where the session was done: a gym name, free text (#48). The app offers previously used names and reuses the stored spelling when the same name is typed with different case or spacing. NULL = not given",
  },
  hang_logs: {
    id: "row id",
    date: "day of the hangboard session",
    preset: "timer preset name used, e.g. 'Max hangs'",
    on_s: "seconds hanging per rep",
    off_s: "seconds rest between reps",
    reps: "planned reps per set",
    sets: "planned sets",
    set_rest_s: "seconds rest between sets",
    completed_reps: "total hangs actually done across all sets (stopping early is recorded)",
    edge_mm: "edge depth in mm",
    grip: "e.g. 'half crimp', 'open hand'",
    added_kg: "added weight in kg; negative = assisted",
    notes: "free text",
    created_at: CREATED_AT,
    client_id: CLIENT_ID,
    warmup: "1 = a warm-up for that day's climbing (#50): part of that session, so no 'hangboard' session of its own and no load; 0 = training (default)",
  },
  timer_presets: {
    id: "row id",
    name: "preset name, e.g. 'Max hangs' (copied into hang_logs.preset)",
    prep_s: "seconds of countdown before the first rep",
    on_s: "seconds hanging per rep",
    off_s: "seconds rest between reps",
    reps: "reps per set",
    sets: "number of sets",
    set_rest_s: "seconds rest between sets",
    edge_mm: "edge depth in mm",
    grip: "e.g. 'half crimp', 'open hand'",
    added_kg: "added weight in kg; negative = assisted",
    notes: "how to do the protocol",
    sort: "display order in the app (ascending)",
  },
  injuries: {
    id: "row id",
    body_part: "e.g. 'finger - A2 pulley', 'elbow', 'shoulder'",
    side: "'left' | 'right' | 'both'",
    description: "free text",
    started_on: "date the injury started",
    resolved_on: "date it resolved; NULL while active",
    created_at: CREATED_AT,
    session_id: "references sessions.id: the session that triggered the injury when logged from the session log; NULL otherwise or if that session was deleted",
    client_id: CLIENT_ID,
  },
  injury_updates: {
    id: "row id",
    injury_id: "references injuries.id",
    date: "day of the update (one update per injury per day)",
    pain: "0 none .. 10 worst",
    note: "free text",
    created_at: CREATED_AT,
    trend: "vs the day before: 'better' | 'same' | 'worse' | 'gone'",
    stiffness: "morning stiffness: 1 yes, 0 no, NULL not asked",
    red_flags: "comma-separated list of 'swelling', 'numbness', 'night_pain'; NULL if none",
  },
  plan: {
    id: "row id",
    date: "planned day (several entries per date allowed)",
    title: "short title, e.g. 'Limit bouldering', 'Rest'",
    type: "same vocabulary as sessions.type, or 'rest'",
    intensity: "'rest' | 'easy' | 'moderate' | 'hard'",
    details: "the actual workout: warm-up, sets, grades, times",
    created_at: CREATED_AT,
    status_override:
      "status set by hand in the app: 'planned' | 'done' | 'partial' | 'skipped' | 'swapped'; NULL = automatic (derived from sessions at read time, see get_overview plan_adherence)",
    duration_min: "planned duration in minutes, optional; a matched session under 60% of it counts as 'partial'",
    expected_benchmarks:
      "tests planned that day as a JSON array of {\"name\", \"unit\"} (names match benchmarks.name); NULL if none",
    source:
      "who wrote the entry: 'coach' (MCP set_plan) or 'app' (added by hand); NULL = written before this was tracked (treated as coach)",
  },
  coach_notes: {
    id: "row id",
    date: "day the note is for",
    text: "the recommendation, short enough to scan on a phone",
    created_at: CREATED_AT,
  },
  coach_runs: {
    id: "row id",
    outcome: "'updated' (changed the plan, notes, profile or questions) | 'no_change'",
    summary: "one or two lines for the climber, shown on the Today screen; NULL for runs with nothing new",
    changes: "JSON array of short strings: what the run changed; NULL if nothing",
    seen_through: "UTC timestamp: data written up to here was reviewed (the next run looks at rows created or updated after it)",
    created_at: CREATED_AT,
  },
  app_feedback: {
    id: "row id",
    text: "the feedback as typed (private: never copied into the public repo)",
    status: "'new' | 'filed' (became issue_number) | 'duplicate' (already covered by issue_number) | 'declined'",
    issue_number: "GitHub issue it was filed as or is a duplicate of; NULL otherwise",
    issue_url: "that issue's link",
    reply: "Claude's short note back, shown in the app",
    handled_at: "when Claude resolved it (UTC timestamp)",
    client_id: CLIENT_ID,
    created_at: CREATED_AT,
  },
  climber_notes: {
    id: "row id",
    text: "the note as typed: extra context for the coach",
    client_id: CLIENT_ID,
    created_at: CREATED_AT,
  },
  coach_questions: {
    id: "row id",
    question: "the question as shown in the app",
    why: "why it is asked, shown under the question; NULL if not given",
    options: "JSON array of answer chips; NULL = free-text question",
    allow_text: "1 = a typed answer is allowed besides the chips, 0 = chips only",
    expires_on: "last day it is shown (local date); NULL = until closed",
    answer: "the climber's answer (a chip label or typed text); NULL until answered",
    answered_at: "when it was answered (UTC timestamp)",
    skipped_at: "when the climber skipped it without answering (UTC timestamp)",
    closed_at: "when Claude closed it: answer used, or question withdrawn (UTC timestamp); closed questions are never shown again",
    run_id: "coach_runs.id of the last run before it was asked (NULL if none)",
    multi: "1 = several chips can be picked; the answer lists them comma-separated",
    topic: "unique key of a question the server creates itself: 'week_days:<Monday>' for the weekly 'which days will you climb' question (#54); NULL for questions Claude asks",
    created_at: CREATED_AT,
  },
  benchmarks: {
    id: "row id",
    date: "day of the test",
    name: "e.g. 'max hang 20mm 10s', 'max pull-ups', 'project grade'",
    value: "result as text (may be a number or a grade)",
    unit: "e.g. 'kg added', 'reps'",
    notes: "free text",
    created_at: CREATED_AT,
    session_id:
      "references sessions.id: set when the result was entered with a session on the Log page (one per name per session, date follows the session); NULL for results from the Benchmarks page or MCP, or if the session was deleted",
  },
  profile: {
    key: "fact name, e.g. 'goal', 'trip_date', 'level', 'weekly_availability', 'timezone'",
    value: "fact value as text",
    updated_at: "last time the value was set (UTC timestamp)",
  },
};

// Removes `-- ...` and `/* ... */` comments (outside string literals and quoted identifiers).
function stripComments(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const end = sql.indexOf(close, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 1;
      out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

// Splits on commas that are not inside parentheses or quotes.
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const end = s.indexOf(c === "[" ? "]" : c, i + 1);
      i = end === -1 ? s.length : end;
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

const TABLE_CONSTRAINT = /^(constraint|primary|unique|check|foreign)\b/i;

function unquote(name: string): string {
  return name.replace(/^["`[]|["`\]]$/g, "");
}

// Rewrites one CREATE TABLE statement with one column per line and its doc as a trailing comment.
// Returns the statement unchanged if it doesn't look like a plain CREATE TABLE (...).
export function annotateCreateTable(sql: string): string {
  const clean = stripComments(sql).trim();
  const head = clean.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|`[^`]+`|\[[^\]]+\]|[\w.]+)\s*\(/i);
  const close = clean.lastIndexOf(")");
  if (!head || close < head[0].length) return sql;
  const table = unquote(head[1].replace(/^main\./i, ""));
  const docs = COLUMN_DOCS[table] ?? {};
  const defs = splitTopLevel(clean.slice(head[0].length, close))
    .map((d) => d.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = defs.map((def, i) => {
    const comma = i < defs.length - 1 ? "," : "";
    const col = TABLE_CONSTRAINT.test(def) ? undefined : unquote(def.split(" ")[0]);
    const doc = col !== undefined ? docs[col] : undefined;
    return `  ${def}${comma}${doc ? ` -- ${doc}` : ""}`;
  });
  const tableDoc = TABLE_DOCS[table];
  const suffix = clean.slice(close + 1).trim();
  return `${tableDoc ? `-- ${table}: ${tableDoc}\n` : ""}${head[0].trim()}\n${lines.join("\n")}\n)${suffix ? ` ${suffix}` : ""}`;
}

// get_schema output: every statement from sqlite_master, CREATE TABLEs annotated with COLUMN_DOCS.
export function annotateSchema(statements: string[]): string {
  const body = statements.map((s) => (/^\s*CREATE\s+TABLE\b/i.test(s) ? annotateCreateTable(s) : s.trim()));
  return `-- ${SCHEMA_NOTES}\n\n${body.join(";\n\n")};`;
}
