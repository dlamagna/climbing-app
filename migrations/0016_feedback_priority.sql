-- Feedback priority (#68): picked in the app when sending feedback. The daily review files the issue with it.
-- Additive: existing rows keep NULL (no priority picked, the review decides).
ALTER TABLE app_feedback ADD COLUMN priority TEXT; -- 'P0' | 'P1' | 'P2', NULL = left to the review
