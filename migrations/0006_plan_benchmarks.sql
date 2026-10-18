-- Expected benchmarks on planned days (issue #22).

-- JSON array of {"name", "unit"} the coach expects to be tested that day, NULL if none. A column rather
-- than a table: plan entries are always written and replaced whole by set_plan, so the list lives and dies
-- with its entry and needs no joins or cascades.
ALTER TABLE plan ADD COLUMN expected_benchmarks TEXT;

-- Benchmark results entered with a session on the Log page are linked to it. One result per test name per
-- session, so a replayed (offline outbox) or re-saved session upserts instead of adding duplicates; rows
-- from the Benchmarks page or MCP keep session_id NULL (unique indexes allow many NULLs).
ALTER TABLE benchmarks ADD COLUMN session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX benchmarks_session_name ON benchmarks(session_id, name);
CREATE INDEX benchmarks_date ON benchmarks(date);
