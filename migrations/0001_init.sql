-- Dates are local calendar dates as 'YYYY-MM-DD'. Timestamps are UTC ISO strings.
-- D1 strips SQL comments when applying migrations, so the comments in these files are for developers only.
-- Claude sees column docs via the MCP get_schema tool, which takes them from worker/schema-docs.ts
-- (every new column needs an entry there; worker/schema-docs.test.ts checks it).

CREATE TABLE checkins (
  date TEXT PRIMARY KEY,          -- the morning of the check-in
  sleep_hours REAL,               -- last night
  sleep_quality INTEGER,          -- 1 bad, 2 ok, 3 good
  feeling INTEGER,                -- 1 wrecked .. 5 fresh (energy + soreness in one)
  drinks INTEGER,                 -- alcoholic drinks yesterday (5 = 5 or more)
  protein TEXT,                   -- yesterday, rough: 'low' | 'ok' | 'high'
  weight_kg REAL,                 -- optional
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,             -- boulder | board | lead | hangboard | strength | cardio | mobility | other
  duration_min INTEGER NOT NULL,
  rpe INTEGER NOT NULL,           -- effort 1..10; training load = duration_min * rpe
  max_grade TEXT,                 -- hardest send, free text (e.g. '6C', 'V5', '7a')
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX sessions_date ON sessions(date);

CREATE TABLE hang_logs (           -- written automatically by the hangboard timer
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  preset TEXT NOT NULL,           -- preset name, e.g. 'Max hangs'
  on_s INTEGER NOT NULL,
  off_s INTEGER NOT NULL,
  reps INTEGER NOT NULL,          -- planned reps per set
  sets INTEGER NOT NULL,          -- planned sets
  set_rest_s INTEGER NOT NULL,
  completed_reps INTEGER NOT NULL,-- total hangs actually done (stopping early is recorded)
  edge_mm INTEGER,
  grip TEXT,                      -- e.g. 'half crimp', 'open hand'
  added_kg REAL,                  -- negative = assisted
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX hang_logs_date ON hang_logs(date);

CREATE TABLE timer_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prep_s INTEGER NOT NULL,
  on_s INTEGER NOT NULL,
  off_s INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  sets INTEGER NOT NULL,
  set_rest_s INTEGER NOT NULL,
  edge_mm INTEGER,
  grip TEXT,
  added_kg REAL,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE injuries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body_part TEXT NOT NULL,        -- e.g. 'finger - A2 pulley', 'elbow', 'shoulder'
  side TEXT,                      -- 'left' | 'right' | 'both'
  description TEXT,
  started_on TEXT NOT NULL,
  resolved_on TEXT,               -- NULL while active
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE injury_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  injury_id INTEGER NOT NULL REFERENCES injuries(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  pain INTEGER NOT NULL,          -- 0 none .. 10 worst
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE plan (                -- planned sessions, usually written by Claude via MCP
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  title TEXT NOT NULL,            -- e.g. 'Limit bouldering', 'Rest'
  type TEXT,                      -- same vocabulary as sessions.type, or 'rest'
  intensity TEXT,                 -- 'rest' | 'easy' | 'moderate' | 'hard'
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX plan_date ON plan(date);

CREATE TABLE coach_notes (         -- recommendations Claude writes back; shown on the Today screen
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX coach_notes_date ON coach_notes(date);

CREATE TABLE benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,             -- e.g. 'max hang 20mm 10s', 'max pull-ups', 'project grade'
  value TEXT NOT NULL,
  unit TEXT,                      -- e.g. 'kg added', 'reps'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE profile (             -- free-form facts about the climber: goal, trip date, level, availability...
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO timer_presets (name, prep_s, on_s, off_s, reps, sets, set_rest_s, edge_mm, grip, added_kg, notes, sort) VALUES
  ('Warm-up', 10, 10, 20, 8, 1, 0, 20, 'half crimp', 0,
   'Build from ~50% to ~80% effort. Use feet / pulley assist for the first few hangs.', 1),
  ('Max hangs', 10, 10, 180, 5, 1, 0, 20, 'half crimp', 0,
   'Eva López style. Add weight so the 10s hang feels like an 8-9/10. Stop if anything feels sharp.', 2),
  ('Repeaters', 10, 7, 3, 6, 4, 180, 20, 'half crimp', 0,
   '7 on / 3 off x6 = one set. Strength-endurance block.', 3),
  ('Abrahangs', 10, 10, 20, 20, 1, 0, 20, 'half crimp', 0,
   'Very easy (~40% effort, feet can stay on). Tendon health, fine most days.', 4);
