// Training load arithmetic, kept free of D1 so it can be unit tested (see load.test.ts).

import { fingerWeight } from "./tags";

// Session types that load the fingers; tracked separately because tendons adapt slower than muscle.
export const FINGER_TYPES = ["boulder", "board", "lead", "hangboard"];

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

// Whole days from `from` to `to` (negative if `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface LoadRow {
  date: string;
  type: string;
  load: number; // duration_min * rpe
  tags?: string | null; // sessions.tags as stored; weights finger load, see worker/tags.ts
}

export interface WeekLoad {
  week_start: string;
  total: number;
  finger: number; // weighted by type and style tags
  finger_raw: number; // unweighted
  sessions: number;
}

export type BaselineStatus = "building" | "partial" | "ok";

export const BASELINE_FULL_DAYS = 28; // history needed before the ratio is trusted
export const BASELINE_MIN_DAYS = 14; // history needed before a provisional ratio is shown
const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;

// Window the queries must cover so computeLoadStats sees every row it needs.
const firstWeekStart = (today: string, weeks: number) => addDays(mondayOf(today), -7 * (weeks - 1));

export function loadWindow(today: string, weeks: number) {
  const from = firstWeekStart(today, weeks);
  const chronicFrom = addDays(today, -(ACUTE_DAYS + CHRONIC_DAYS - 1));
  return { from: from < chronicFrom ? from : chronicFrom, to: today };
}

// Training load = minutes x effort (session-RPE). Compares the last 7 days against the average
// week of the 28 days before; a ratio well above ~1.3 means load is ramping up quickly.
//
// Cold start: history_days counts days from the first session to today, both inclusive (a first
// session today = 1, no sessions = 0). The chronic average only uses the part of the 28-day window
// that falls on or after the first session, scaled to a weekly figure, so it is not dragged down by
// days before logging began. Under 14 days of history there is no ratio ("building"); from 14 to 27
// the ratio is shown but marked provisional ("partial"); from 28 it is trusted ("ok"). With 35+
// days the whole chronic window exists and this is the plain sum / 4.
//
// Finger load: `finger` multiplies each finger session's load by its type x style-tag weight (fingerWeight in
// worker/tags.ts) and drives ratio_finger; `finger_raw` is the plain unweighted sum.
export function computeLoadStats(rows: LoadRow[], today: string, firstSessionDate: string | null, weeks = 6) {
  const from = firstWeekStart(today, weeks);

  type Kind = "total" | "finger" | "finger_raw";
  const value = (r: LoadRow, kind: Kind) =>
    kind === "total" ? r.load : !FINGER_TYPES.includes(r.type) ? 0 : kind === "finger_raw" ? r.load : r.load * fingerWeight(r.type, r.tags);
  // Unrounded, so weighted averages are rounded once at the end.
  const rawSum = (lo: string, hi: string, kind: Kind) =>
    rows.filter((r) => r.date >= lo && r.date <= hi).reduce((acc, r) => acc + value(r, kind), 0);
  const sum = (lo: string, hi: string, kind: Kind) => Math.round(rawSum(lo, hi, kind));

  const historyDays = firstSessionDate ? Math.max(0, daysBetween(firstSessionDate, today) + 1) : 0;
  const status: BaselineStatus =
    historyDays < BASELINE_MIN_DAYS ? "building" : historyDays < BASELINE_FULL_DAYS ? "partial" : "ok";

  const acuteFrom = addDays(today, -(ACUTE_DAYS - 1));
  const chronicTo = addDays(today, -ACUTE_DAYS);
  const chronicDays = Math.min(CHRONIC_DAYS, Math.max(0, historyDays - ACUTE_DAYS));
  const chronicFrom = addDays(chronicTo, -(chronicDays - 1));
  const weekly = (kind: Kind) =>
    chronicDays > 0 ? Math.round((rawSum(chronicFrom, chronicTo, kind) / chronicDays) * 7) : 0;

  const last7 = {
    total: sum(acuteFrom, today, "total"),
    finger: sum(acuteFrom, today, "finger"),
    finger_raw: sum(acuteFrom, today, "finger_raw"),
  };
  const prevWeeklyAvg = { total: weekly("total"), finger: weekly("finger"), finger_raw: weekly("finger_raw") };
  const ratio = (a: number, b: number) =>
    status !== "building" && b > 0 ? Math.round((a / b) * 100) / 100 : null;

  const byWeek: WeekLoad[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 6);
    byWeek.push({
      week_start: start,
      total: sum(start, end, "total"),
      finger: sum(start, end, "finger"),
      finger_raw: sum(start, end, "finger_raw"),
      sessions: rows.filter((r) => r.date >= start && r.date <= end).length,
    });
  }

  return {
    last7,
    prev28_weekly_avg: prevWeeklyAvg,
    ratio_total: ratio(last7.total, prevWeeklyAvg.total),
    ratio_finger: ratio(last7.finger, prevWeeklyAvg.finger),
    history_days: historyDays,
    baseline_status: status,
    ratio_provisional: status === "partial",
    weeks: byWeek,
  };
}

export type LoadStats = ReturnType<typeof computeLoadStats>;
