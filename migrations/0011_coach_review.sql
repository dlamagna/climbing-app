-- Daily coach review (#52): a scheduled Claude run reviews new data, adjusts the plan, and asks the climber
-- questions it can't answer from the data. Additive: existing rows are untouched.

-- One row per review run, so the next run knows what is new since the last one.
CREATE TABLE coach_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome TEXT NOT NULL,          -- 'updated' | 'no_change'
  summary TEXT,                   -- one or two lines, shown on the Today screen
  changes TEXT,                   -- JSON array of short strings: what the run changed
  seen_through TEXT NOT NULL,     -- UTC timestamp: data written up to here was reviewed
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Questions Claude asks; shown as cards on the Today screen until answered, skipped, expired or closed.
CREATE TABLE coach_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  why TEXT,                       -- why it is asked, shown under the question
  options TEXT,                   -- JSON array of answer chips; NULL = free text only
  allow_text INTEGER NOT NULL DEFAULT 1, -- a free-text answer is allowed besides the chips
  expires_on TEXT,                -- last day it is shown (local date); NULL = until closed
  answer TEXT,
  answered_at TEXT,
  skipped_at TEXT,                -- the climber dismissed it without answering
  closed_at TEXT,                 -- Claude used the answer, or withdrew the question
  run_id INTEGER REFERENCES coach_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX coach_questions_open ON coach_questions(closed_at, answered_at, skipped_at);

-- Who wrote a plan entry: 'coach' (MCP set_plan) or 'app' (added by hand). NULL = written before this column
-- existed (treated as coach). A review rewrites only coach entries.
ALTER TABLE plan ADD COLUMN source TEXT;

-- App feedback typed in the app (bugs, ideas). The daily review decides whether each one becomes a GitHub
-- issue on the public repo (rewritten without personal details) and records what it did.
CREATE TABLE app_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- 'new' | 'filed' | 'duplicate' | 'declined'
  issue_number INTEGER,           -- the GitHub issue it was filed as or folded into
  issue_url TEXT,
  reply TEXT,                     -- Claude's short note back, shown in the app
  handled_at TEXT,
  client_id TEXT,                 -- idempotent offline replays, like sessions.client_id
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX app_feedback_client_id ON app_feedback(client_id);
