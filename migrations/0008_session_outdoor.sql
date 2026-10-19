-- Indoor/outdoor flag on sessions (issue #33): 1 = outdoors (crag, boulders), 0 = indoors (gym).
-- Only climbing types (boulder, board, lead, toprope) can be outdoor; see worker/sessions.ts.
-- Additive: existing sessions get the default and stay indoor.

ALTER TABLE sessions ADD COLUMN outdoor INTEGER NOT NULL DEFAULT 0;
