// Month grid, day bucketing and mix periods for the History calendar (#32). Pure string date maths
// (no timezone involved: dates are already the phone's local 'YYYY-MM-DD'), unit tested in calendar.test.ts.

import { addDays } from "../worker/load";
import { GROUP_KEYS, groupOf } from "../worker/typeGroups";

const pad = (n: number) => String(n).padStart(2, "0");

// 'YYYY-MM' of a date.
export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + by;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => addDays(monthStart(shiftMonth(month, 1)), -1);

export const monthLabel = (month: string) =>
  new Date(`${monthStart(month)}T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

// Weeks (Monday first) covering the month; days outside it are null so the grid keeps its shape.
export function monthGrid(month: string): (string | null)[][] {
  const first = monthStart(month);
  const last = monthEnd(month);
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Sessions per day for one month, each day ordered by group (rope, boulder, fingers, other) then id,
// so markers sit in the same order as the legend. Sessions outside the month are left out.
export function sessionsByDay<T extends { id: number; date: string; type: string }>(sessions: readonly T[], month: string) {
  const days: Record<string, T[]> = {};
  for (const s of sessions) {
    if (monthOf(s.date) !== month) continue;
    (days[s.date] ??= []).push(s);
  }
  const rank = (s: T) => GROUP_KEYS.indexOf(groupOf(s.type));
  for (const list of Object.values(days)) list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  return days;
}

export type MixPeriod = "4w" | "8w" | "month";

// Date range a mix period covers: the last 28 or 56 days ending today, or the month on screen.
export function periodRange(period: MixPeriod, today: string, month: string): { from: string; to: string } {
  if (period === "month") return { from: monthStart(month), to: monthEnd(month) };
  return { from: addDays(today, period === "4w" ? -27 : -55), to: today };
}
