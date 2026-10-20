-- Plan my climbing days (#75): re-saving the same day used to keep the window the row was first saved with,
-- so a row first saved under the older 7-day window kept cutting later picked days off. Give every
-- climb_days row its full window again (that date and the 9 days after, CLIMB_DAYS_AHEAD = 10).
UPDATE coach_questions
SET expires_on = date(substr(topic, length('climb_days:') + 1), '+9 days')
WHERE topic LIKE 'climb_days:%'
  AND (expires_on IS NULL OR expires_on < date(substr(topic, length('climb_days:') + 1), '+9 days'));
