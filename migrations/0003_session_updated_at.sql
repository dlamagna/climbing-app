-- Set when a session is edited after it was logged (NULL = never edited), so History can mark it.

ALTER TABLE sessions ADD COLUMN updated_at TEXT;
