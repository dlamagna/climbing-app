-- Routines started by the app: logging a training session starts the coach review, and the review recording
-- its run starts the issue worker when there are issues for it. Both can still be started by hand from
-- Coach → Coach activity. One row per start, so a session is only followed up once.
-- Additive: no existing table changes.
CREATE TABLE routine_starts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine TEXT NOT NULL,          -- 'review' | 'worker'
  started_by TEXT NOT NULL,       -- 'session' (after a logged session) | 'app' (Run now on the Coach tab)
  session_id INTEGER,             -- 'session' starts: the newest session it followed up (no FK: sessions get deleted)
  status TEXT NOT NULL,           -- 'starting' | 'started' | 'failed' | 'skipped' (worker: nothing to work on)
  error TEXT,                     -- why a start failed or was skipped
  session_url TEXT,               -- the Claude Code session that was started, when Claude returned one
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX routine_starts_chain ON routine_starts(started_by, routine, session_id);
