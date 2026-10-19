-- Where a session was done (#48): a gym name, free text. Known gyms are the distinct values (no separate
-- table); the app offers them in a type-to-filter dropdown. Additive: existing sessions keep NULL.
ALTER TABLE sessions ADD COLUMN gym TEXT;
