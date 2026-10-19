-- Weekly "which days will you climb?" question (#54).
-- multi: several chips can be picked (the answer lists them, comma-separated).
ALTER TABLE coach_questions ADD COLUMN multi INTEGER NOT NULL DEFAULT 0;
-- topic: unique key for questions the server creates itself, e.g. 'week_days:2026-01-05' (one per week, keyed
-- by its Monday); NULL for questions Claude asks.
ALTER TABLE coach_questions ADD COLUMN topic TEXT;
CREATE UNIQUE INDEX coach_questions_topic ON coach_questions(topic);
