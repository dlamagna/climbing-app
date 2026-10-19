// Shared by the worker (worker/coach.ts) and the app (src/coachAnswers.ts): no D1 here.

// Topic prefix of the weekly "which days will you climb" question (#54): 'week_days:<Monday>'.
export const WEEK_TOPIC = "week_days";
// Its chip for a week without climbing; picking it clears the days in the app.
export const NOT_THIS_WEEK = "Not this week";

// Topic prefix of climbing days picked with Today's "Plan my climbing days" button (#56): 'climb_days:<date>',
// one per day it was set; it covers that date and the CLIMB_DAYS_AHEAD - 1 days after.
export const CLIMB_DAYS_TOPIC = "climb_days";
export const CLIMB_DAYS_AHEAD = 7;
// The chip for "none of these days" in the button's picker.
export const NO_CLIMBING = "No climbing";
