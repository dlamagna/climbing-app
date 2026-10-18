-- Plan vs actual (#21). Statuses and session <-> plan links are derived at read time (worker/plan.ts);
-- only what the climber or coach sets explicitly is stored here.

-- Pinned link: "this session was that planned entry" (e.g. done on another day). NULL = matched
-- automatically by date and type. Deleting or replacing the plan entry clears it.
ALTER TABLE sessions ADD COLUMN plan_id INTEGER REFERENCES plan(id) ON DELETE SET NULL;
CREATE INDEX sessions_plan_id ON sessions(plan_id);

-- Status picked by hand in the app: 'planned' | 'done' | 'partial' | 'skipped' | 'swapped'; NULL = automatic.
ALTER TABLE plan ADD COLUMN status_override TEXT;

-- Planned duration in minutes, optional; a matched session well under it counts as 'partial'.
ALTER TABLE plan ADD COLUMN duration_min INTEGER;
