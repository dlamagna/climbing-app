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
  benchmarks: "benchmark / test results over time",
  profile: "free-form facts about the climber as key/value pairs: goal, trip_date, level, availability, timezone...",
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
    type: "boulder | board | lead | hangboard | strength | cardio | mobility | other",
    duration_min: "duration in minutes",
    rpe: "effort 1..10; training load = duration_min * rpe",
    max_grade: "hardest send, free text (e.g. '6C', 'V5', '7a')",
    notes: "free text",
    created_at: CREATED_AT,
    client_id: CLIENT_ID,
    updated_at: "when the session was last edited after logging (UTC timestamp); NULL = never edited",
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
  },
  coach_notes: {
    id: "row id",
    date: "day the note is for",
    text: "the recommendation, short enough to scan on a phone",
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
