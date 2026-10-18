-- Daily injury follow-up from the morning check-in (issue #16).

ALTER TABLE injury_updates ADD COLUMN trend TEXT;
ALTER TABLE injury_updates ADD COLUMN stiffness INTEGER;
ALTER TABLE injury_updates ADD COLUMN red_flags TEXT;

-- One update per injury per day, so re-submitting the check-in upserts. Keep the latest of any duplicates.
DELETE FROM injury_updates WHERE id NOT IN (SELECT MAX(id) FROM injury_updates GROUP BY injury_id, date);
CREATE UNIQUE INDEX injury_updates_day ON injury_updates(injury_id, date);

ALTER TABLE injuries ADD COLUMN session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL;

-- Same idempotency scheme as 0002, for injuries quick-added while offline.
ALTER TABLE injuries ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX injuries_client_id ON injuries(client_id);
