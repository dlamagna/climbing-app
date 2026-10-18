// Training load arithmetic, kept free of D1 so it can be unit tested (see load.test.ts).

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
}

export interface WeekLoad {
  week_start: string;
  total: number;
  finger: number;
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
export function computeLoadStats(rows: LoadRow[], today: string, firstSessionDate: string | null, weeks = 6) {
  const from = firstWeekStart(today, weeks);

  const sum = (lo: string, hi: string, fingerOnly: boolean) =>
    rows
      .filter((r) => r.date >= lo && r.date <= hi && (!fingerOnly || FINGER_TYPES.includes(r.type)))
      .reduce((acc, r) => acc + r.load, 0);

  const historyDays = firstSessionDate ? Math.max(0, daysBetween(firstSessionDate, today) + 1) : 0;
  const status: BaselineStatus =
    historyDays < BASELINE_MIN_DAYS ? "building" : historyDays < BASELINE_FULL_DAYS ? "partial" : "ok";

  const acuteFrom = addDays(today, -(ACUTE_DAYS - 1));
  const chronicTo = addDays(today, -ACUTE_DAYS);
  const chronicDays = Math.min(CHRONIC_DAYS, Math.max(0, historyDays - ACUTE_DAYS));
  const chronicFrom = addDays(chronicTo, -(chronicDays - 1));
  const weekly = (fingerOnly: boolean) =>
    chronicDays > 0 ? Math.round((sum(chronicFrom, chronicTo, fingerOnly) / chronicDays) * 7) : 0;

  const last7 = { total: sum(acuteFrom, today, false), finger: sum(acuteFrom, today, true) };
  const prevWeeklyAvg = { total: weekly(false), finger: weekly(true) };
  const ratio = (a: number, b: number) =>
    status !== "building" && b > 0 ? Math.round((a / b) * 100) / 100 : null;

  const byWeek: WeekLoad[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 6);
    byWeek.push({
      week_start: start,
      total: sum(start, end, false),
      finger: sum(start, end, true),
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
