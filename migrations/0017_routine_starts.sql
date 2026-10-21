-- Routines started by the app: the coach review starts about 30 minutes after a training session is
-- logged, and the issue worker right after it; both can still be started by hand from Coach → Coach activity.
-- One row per start attempt, so the scheduled check knows which sessions were already followed up.
-- Additive: no existing table changes.
CREATE TABLE routine_starts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine TEXT NOT NULL,          -- 'review' | 'worker'
  started_by TEXT NOT NULL,       -- 'session' (after a logged session) | 'app' (Run now on the Coach tab)
  session_logged_at TEXT,         -- 'session' starts: created_at of the newest session it followed up
  status TEXT NOT NULL,           -- 'started' | 'failed'
  error TEXT,                     -- why a start failed
  session_url TEXT,               -- the Claude Code session that was started, when Claude returned one
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX routine_starts_chain ON routine_starts(started_by, routine, session_logged_at);
