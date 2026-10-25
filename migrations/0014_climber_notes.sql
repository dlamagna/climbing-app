-- Notes to the coach (#65): free-text context the climber sends from the Today screen. The daily coach review
-- gets the ones written since its last run. Additive: existing rows are untouched.
CREATE TABLE climber_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  client_id TEXT,                 -- idempotent offline replays, like sessions.client_id
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX climber_notes_client_id ON climber_notes(client_id);
