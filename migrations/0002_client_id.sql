-- Idempotency for offline replays: the phone sends a random id with each insert, so a write that reached
-- the server but lost its response isn't inserted twice when the outbox retries it. NULL for older rows
-- and for rows written via MCP (unique indexes allow many NULLs).

ALTER TABLE sessions ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX sessions_client_id ON sessions(client_id);

ALTER TABLE hang_logs ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX hang_logs_client_id ON hang_logs(client_id);
