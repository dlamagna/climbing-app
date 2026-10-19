-- Hangboard warm-ups (#50): a timer run done as a warm-up for that day's climbing is kept as a hang log with
-- warmup = 1 and no session, so it doesn't count as a separate training session or add load. Additive:
-- existing hang logs stay 0.
ALTER TABLE hang_logs ADD COLUMN warmup INTEGER NOT NULL DEFAULT 0;
