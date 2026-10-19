// Answering coach questions in the app (#52, #54): pure helpers, unit tested in coachAnswers.test.ts.
import { NOT_THIS_WEEK, WEEK_TOPIC } from "../worker/coachTopics";
import type { CoachQuestion } from "./types";

export { NOT_THIS_WEEK };

export const isWeekly = (q: Pick<CoachQuestion, "topic">) => Boolean(q.topic?.startsWith(`${WEEK_TOPIC}:`));

// A multi question's answer: the picked chips in the options' order, then the typed note after " - ".
export function multiAnswer(picked: string[], options: string[], note: string): string {
  const chips = options.filter((o) => picked.includes(o)).join(", ");
  return [chips, note.trim()].filter(Boolean).join(" - ");
}

// Picking "Not this week" clears the days, and picking a day clears it.
export function togglePick(picked: string[], option: string): string[] {
  if (picked.includes(option)) return picked.filter((p) => p !== option);
  if (option === NOT_THIS_WEEK) return [option];
  return [...picked.filter((p) => p !== NOT_THIS_WEEK), option];
}
