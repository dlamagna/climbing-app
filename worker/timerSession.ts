// Pure rules for the hangboard session that the timer logs together with each hang log (#26), so a
// timer run always counts toward training load even if nobody taps anything on the finished screen.

// Effort used when this preset has no earlier timer session to copy from. The seeded presets get their
// own value (their notes describe the intended effort); anything else gets a middling 6, "moderate-hard",
// since a deliberate hangboard block is rarely easy. The finished screen and History can change it.
export const DEFAULT_TIMER_RPE = 6;
export const PRESET_DEFAULT_RPE: Record<string, number> = {
  "Warm-up": 4,
  "Max hangs": 8,
  Repeaters: 7,
  Abrahangs: 3,
};

// Runs aborted before the first hang finished log nothing at all (no hang log, no session).
export const MIN_COMPLETED_HANGS = 1;

export const isRpe = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10;

// Last effort the climber gave this preset wins, then the preset's default, then the global one.
export function defaultTimerRpe(preset: string, lastRpe: number | null | undefined): number {
  if (isRpe(lastRpe)) return lastRpe;
  return PRESET_DEFAULT_RPE[preset] ?? DEFAULT_TIMER_RPE;
}

export const shouldLogTimerSession = (completedReps: unknown): boolean =>
  typeof completedReps === "number" && completedReps >= MIN_COMPLETED_HANGS;

// The session's client_id is derived from the hang log's, so both rows are covered by the one
// Idempotency-Key the app sends, and the finished screen can address the session even while offline.
export const SESSION_KEY_SUFFIX = ":session";
export const timerSessionClientId = (hangClientId: string): string => hangClientId + SESSION_KEY_SUFFIX;

export const timerSessionNotes = (preset: string, completedReps: number, plannedReps: number): string =>
  `${preset}: ${completedReps}/${plannedReps} hangs`;
