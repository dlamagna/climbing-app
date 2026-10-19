// Weekly summary (#9): the current week (Monday -> today) at a glance, for the Today card and get_overview's
// week_summary, so the climber and the coach see the same numbers. Pure (no D1, no DOM; unit tested in
// weekSummary.test.ts) and built only from existing pieces: plan.ts's week-so-far counts, load.ts's weekly finger
// load and baseline status, typeGroups.ts's mix. The text helpers are shared with src/components/WeekSummary.tsx.

import { type BaselineStatus, type WeekLoad, addDays, daysBetween, mondayOf } from "./load";
import { type PlanRow, type PlanStatus, isRestEntry, weekSummary as planWeekSoFar } from "./plan";
import { gymCounts, gymsText } from "./gyms";
import { type MixSession, climbingShares, formatMinutes, groupMix, inRange } from "./typeGroups";

// Check-in fields the summary reads. A check-in dated D describes the night before D (sleep) and the day
// before D (drinks), so "this week" means the check-ins dated Monday to today.
export interface WeekCheckin {
  date: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null; // 1 bad, 2 ok, 3 good
  drinks?: number | null; // 0-5, 5 = "5+"
}

export interface WeekLoadStats {
  weeks: WeekLoad[];
  prev28_weekly_avg: { finger: number };
  baseline_status: BaselineStatus;
  history_days: number;
}

export interface WeekSummaryInput {
  today: string;
  checkins: readonly WeekCheckin[]; // any range; filtered to Monday..today here
  sessions: readonly MixSession[]; // any range; filtered to Monday..today here
  plan: readonly (Pick<PlanRow, "date" | "type" | "intensity"> & { status?: PlanStatus })[]; // entries with derived status
  load: WeekLoadStats; // computeLoadStats output (its weeks must include this week)
}

export const DRINKS_CAP = 5; // the check-in's top choice is "5+"

const round1 = (n: number) => Math.round(n * 10) / 10;
const average = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function computeWeekSummary({ today, checkins, sessions, plan, load }: WeekSummaryInput) {
  const week_start = mondayOf(today);
  const weekEnd = addDays(week_start, 6);
  const ci = inRange(checkins, week_start, today);
  const hours = ci.map((c) => c.sleep_hours).filter(isNum);
  const quality = ci.map((c) => c.sleep_quality).filter(isNum);
  const drinks = ci.map((c) => c.drinks).filter(isNum);

  const weekSessions = inRange(sessions, week_start, today);
  const mix = groupMix(weekSessions);
  const shares = climbingShares(mix);

  const withStatus = plan.filter((e): e is typeof e & { status: PlanStatus } => e.status !== undefined);
  const thisWeek = load.weeks.find((w) => w.week_start === week_start);

  return {
    week_start,
    days: daysBetween(week_start, today) + 1, // 1 on Monday, 7 on Sunday
    checkins: ci.length,
    sleep: {
      nights: hours.length, // check-ins with sleep hours; gaps are left out of the average, not counted as 0
      avg_hours: average(hours),
      avg_quality: average(quality), // 1-3
    },
    drinks: {
      total: drinks.reduce((a, b) => a + b, 0),
      days_logged: drinks.length,
      capped: drinks.some((d) => d >= DRINKS_CAP), // a "5+" day: the total is a minimum
    },
    sessions: {
      logged: weekSessions.length, // planned or not
      planned_this_week: plan.filter((e) => e.date >= week_start && e.date <= weekEnd && !isRestEntry(e)).length,
      so_far: planWeekSoFar(withStatus, today), // the same counts as plan_week_so_far
    },
    finger: {
      this_week: thisWeek?.finger ?? 0, // weighted, Monday to today
      usual_weekly: load.baseline_status === "building" ? null : load.prev28_weekly_avg.finger,
      baseline_status: load.baseline_status,
      history_days: load.history_days,
    },
    mix: {
      rope_min: mix.rope.minutes,
      boulder_min: mix.boulder.minutes,
      rope_share: shares.rope, // % of climbing time; null with no climbing
      boulder_share: shares.boulder,
    },
    gyms: gymCounts(weekSessions), // sessions per gym this week (#48), most first
  };
}

export type WeekSummaryView = ReturnType<typeof computeWeekSummary>;

// --- One-line texts (null = nothing to show for that row) ----------------------------------------------

const QUALITY = ["Bad", "OK", "Good"];

// "7.2h avg · quality OK (2.4/3)"
export function sleepText(s: WeekSummaryView["sleep"]): string | null {
  if (s.avg_hours === null && s.avg_quality === null) return null;
  const parts = [];
  if (s.avg_hours !== null) parts.push(`${s.avg_hours}h avg`);
  if (s.avg_quality !== null) parts.push(`quality ${QUALITY[Math.round(s.avg_quality) - 1] ?? "?"} (${s.avg_quality}/3)`);
  return parts.join(" · ");
}

// "4" or "7+" (a "5+" day makes the total a minimum).
export function drinksText(d: WeekSummaryView["drinks"]): string | null {
  if (!d.days_logged) return null;
  return `${d.total}${d.capped ? "+" : ""}`;
}

// "3 logged · 2 of 4 planned done, 1 skipped"; "2 logged · no plan".
export function sessionsText(s: WeekSummaryView["sessions"]): string {
  const logged = `${s.logged} logged`;
  if (!s.planned_this_week) return `${logged} · no plan`;
  const extras = (["partial", "swapped", "skipped"] as const).filter((k) => s.so_far[k] > 0).map((k) => `${s.so_far[k]} ${k}`);
  return [`${logged} · ${s.so_far.done} of ${s.planned_this_week} planned done`, ...extras].join(", ");
}

// "180 · 60% of a usual week"; "building baseline" while there is too little history to compare with.
export function fingerText(f: WeekSummaryView["finger"]): string {
  const base = String(f.this_week);
  if (f.baseline_status === "building" || f.usual_weekly === null) return `${base} · building baseline`;
  const note = f.baseline_status === "partial" ? " (provisional)" : "";
  if (f.usual_weekly <= 0) return `${base} · none in the weeks before${note}`;
  return `${base} · ${Math.round((f.this_week / f.usual_weekly) * 100)}% of a usual week (~${f.usual_weekly})${note}`;
}

// "Rope 1h 30m (60%) · Boulder 1h (40%)", or null with no climbing.
export function mixText(m: WeekSummaryView["mix"]): string | null {
  if (m.rope_share === null || m.boulder_share === null) return null;
  return `Rope ${formatMinutes(m.rope_min)} (${m.rope_share}%) · Boulder ${formatMinutes(m.boulder_min)} (${m.boulder_share}%)`;
}

// "Gym A ×3 · Gym B", or null when no session this week has a gym.
export const gymsRowText = (g: WeekSummaryView["gyms"]) => gymsText(g);

// True when the week has nothing in it yet (e.g. Monday morning before the check-in).
export const isEmptyWeek = (w: WeekSummaryView) =>
  w.checkins === 0 && w.sessions.logged === 0 && w.sessions.planned_this_week === 0;
