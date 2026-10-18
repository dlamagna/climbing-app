// Date rules for injuries, shared by the API (worker/index.ts) and the app's forms so both check the same thing.

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s); // rejects e.g. 2026-02-30
}

// The first problem with an injury's dates, or null when they're fine. resolvedOn is optional (still active).
// With today, dates after it are rejected too (the app passes the phone's date; the server doesn't know it).
export function injuryDatesError(startedOn: unknown, resolvedOn?: unknown, today?: string): string | null {
  if (!isIsoDate(startedOn)) return "Start date must be YYYY-MM-DD";
  if (today && startedOn > today) return "Start date can't be in the future";
  if (resolvedOn === null || resolvedOn === undefined || resolvedOn === "") return null;
  if (!isIsoDate(resolvedOn)) return "Healed date must be YYYY-MM-DD";
  if (resolvedOn < startedOn) return "Healed date can't be before the start date";
  if (today && resolvedOn > today) return "Healed date can't be in the future";
  return null;
}

// An injury added from a session (log, or a past note) starts on that session's day; otherwise today.
export const defaultStartedOn = (today: string, sessionDate?: string | null): string => sessionDate || today;
