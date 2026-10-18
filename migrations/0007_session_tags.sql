-- Optional style tags on climbing sessions (issue #25): comma-separated, see worker/tags.ts.
-- Existing sessions stay untagged (NULL), which counts as an unweighted finger load.

ALTER TABLE sessions ADD COLUMN tags TEXT;
