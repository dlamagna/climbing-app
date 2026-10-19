// Answering coach questions in the app (#52, #54): pure helpers, unit tested in coachAnswers.test.ts.
import { CLIMB_DAYS_AHEAD, NOT_THIS_WEEK, NO_CLIMBING, WEEK_TOPIC } from "../worker/coachTopics";
import { addDays } from "./dates";
import type { CoachQuestion } from "./types";

export { CLIMB_DAYS_AHEAD, NOT_THIS_WEEK, NO_CLIMBING };

export const isWeekly = (q: Pick<CoachQuestion, "topic">) => Boolean(q.topic?.startsWith(`${WEEK_TOPIC}:`));

// A multi question's answer: the picked chips in the options' order, then the typed note after " - ".
export function multiAnswer(picked: string[], options: string[], note: string): string {
  const chips = options.filter((o) => picked.includes(o)).join(", ");
  return [chips, note.trim()].filter(Boolean).join(" - ");
}

// Picking the "none" option ("Not this week", "No climbing") clears the days, and picking a day clears it.
export function togglePick(picked: string[], option: string, none = NOT_THIS_WEEK): string[] {
  if (picked.includes(option)) return picked.filter((p) => p !== option);
  if (option === none) return [option];
  return [...picked.filter((p) => p !== none), option];
}

// The days "Plan my climbing days" offers: today and the next CLIMB_DAYS_AHEAD - 1.
export const plannerDays = (today: string) => Array.from({ length: CLIMB_DAYS_AHEAD }, (_, i) => addDays(today, i));

// The request body from what is picked (dates and/or NO_CLIMBING), or null while nothing is picked.
export function climbingDaysBody(picked: string[], note: string): { days: string[]; note: string | null } | null {
  const days = picked.filter((p) => p !== NO_CLIMBING).sort();
  if (!days.length && !picked.includes(NO_CLIMBING)) return null;
  return { days, note: note.trim() || null };
}
