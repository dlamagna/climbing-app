// Readiness (#23): one green / amber / red call for today, from the morning check-in, recent load, the
// plan and active injuries. Pure (no D1) so it can be unit tested (readiness.test.ts) and imported by the
// app. The worker computes it for both /api/today and MCP get_overview, so the app and the coach agree.
// It is advisory only: nothing in the app is ever blocked by it.
//
// Scoring: each signal adds points (thresholds below). 0 points = green, AMBER_POINTS+ = amber,
// RED_POINTS+ = red. A red flag in an active injury's latest update is red on its own. The load group
// (ratios + plan) is capped at LOAD_MAX_POINTS so load alone never makes a red day; it needs a second signal.
//
// - Check-in: low feeling, short or bad sleep, drinks yesterday. Missing fields are skipped. With no
//   check-in at all, these are skipped and a "no check-in yet" note is added to the reasons (the level then
//   comes from load and injuries only, so it can still be amber / red).
// - Consecutive hard days: hard as defined in worker/plan.ts (isHardDay: effort >= HARD_RPE or day load >=
//   HARD_DAY_LOAD), counted back from yesterday. Today's sessions don't count: readiness is about going
//   into today.
// - Load vs baseline: ratio_total / ratio_finger from worker/load.ts. No ratio reasons while the baseline is
//   "building"; while "partial" the wording says so and each ratio adds at most 1 point.
// - Load vs plan: last-7 total against the planned load of the same 7 days, estimated as duration_min x a
//   typical effort per intensity. Only when every non-rest entry in those days has a duration and an
//   intensity, so a half-filled plan can't raise a false alarm. Works during "building" too.
// - Injuries: the latest update of each active injury, if recent: any red flag -> red; trend worse -> at
//   least amber.

import { daysBetween, addDays, type LoadStats } from "./load";
import { type PlanRow, type SessionRow, isHardDay, isRestEntry } from "./plan";

// --- Thresholds, all in one place -------------------------------------------------------------------
export const READINESS = {
  FEELING_LOW: 2, // feeling (1 wrecked .. 5 fresh) at or below: 1 point
  FEELING_VERY_LOW: 1, // at or below: 2 points
  SLEEP_SHORT_H: 6, // sleep_hours below: 1 point
  SLEEP_VERY_SHORT_H: 5, // below: 2 points
  SLEEP_QUALITY_BAD: 1, // sleep_quality (1 bad .. 3 good) at or below: 1 point
  DRINKS_SOME: 3, // drinks yesterday at or above: 1 point
  DRINKS_MANY: 5, // at or above (5 = 5 or more): 2 points
  HARD_STREAK: 2, // consecutive hard days before today, at or above: 1 point
  HARD_STREAK_LONG: 3, // at or above: 2 points
  RATIO_HIGH: 1.3, // load ratio above: 1 point (same cut-offs as the app's load card)
  RATIO_VERY_HIGH: 1.5, // above: 2 points ("ok" baseline only; "partial" stays at 1)
  PLAN_OVER: 1.3, // last-7 load above planned load x this: 1 point
  PLAN_EFFORT: { easy: 3, moderate: 5, hard: 8 } as Record<string, number>, // effort assumed per plan intensity
  LOAD_MAX_POINTS: 2, // cap for ratios + plan together
  INJURY_RECENT_DAYS: 2, // an injury update counts if dated today or up to this many days before
  AMBER_POINTS: 1,
  RED_POINTS: 3,
};

export type ReadinessLevel = "green" | "amber" | "red";

export interface Readiness {
  level: ReadinessLevel;
  reasons: string[]; // short, each with an action hint
}

export interface ReadinessCheckin {
  date?: string;
  feeling?: number | null;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  drinks?: number | null;
}

export type ReadinessLoad = Pick<
  LoadStats,
  "last7" | "prev28_weekly_avg" | "ratio_total" | "ratio_finger" | "baseline_status" | "history_days"
>;

export type ReadinessSession = Pick<SessionRow, "date" | "duration_min" | "rpe">;

export interface ReadinessInjury {
  body_part: string;
  side?: string | null;
  updates?: { date: string; trend?: string | null; red_flags?: string | null }[];
}

export interface ReadinessExtras {
  today?: string; // defaults to the check-in's date, else the latest session date
  injuries?: ReadinessInjury[]; // active ones (resolved_on IS NULL)
  plan?: Pick<PlanRow, "date" | "type" | "intensity" | "duration_min">[];
}

// A session that counts as hard on its own (same definition as a hard day in worker/plan.ts). The Log page
// uses it to decide when to show its note on an amber / red day.
export const isHardSession = (s: Pick<SessionRow, "duration_min" | "rpe">) => isHardDay([s]);

// Hard days in a row, counted back from the day before `today`.
export function hardStreak(sessions: ReadinessSession[], today: string): number {
  let n = 0;
  for (let d = addDays(today, -1); ; d = addDays(d, -1)) {
    const day = sessions.filter((s) => s.date === d);
    if (!day.length || !isHardDay(day)) return n;
    n++;
  }
}

// Planned load for the 7 days ending today, or null when the plan for those days isn't complete enough.
export function plannedLoad(plan: ReadinessExtras["plan"], today: string): number | null {
  const from = addDays(today, -6);
  const entries = (plan ?? []).filter((e) => e.date >= from && e.date <= today && !isRestEntry(e));
  if (!entries.length) return null;
  let sum = 0;
  for (const e of entries) {
    const effort = e.intensity ? READINESS.PLAN_EFFORT[e.intensity] : undefined;
    if (!e.duration_min || e.duration_min <= 0 || effort === undefined) return null;
    sum += e.duration_min * effort;
  }
  return sum;
}

const injuryName = (i: ReadinessInjury) => (i.side ? `${i.body_part} (${i.side})` : i.body_part);

export function readiness(
  checkin: ReadinessCheckin | null | undefined,
  load: ReadinessLoad | null | undefined,
  recentSessions: ReadinessSession[] = [],
  extras: ReadinessExtras = {},
): Readiness {
  const R = READINESS;
  const today =
    extras.today ?? checkin?.date ?? recentSessions.reduce<string | null>((m, s) => (!m || s.date > m ? s.date : m), null);
  const reasons: string[] = [];
  let points = 0;
  let forcedRed = false;

  // Injuries first: the coach weighs them above everything else.
  for (const inj of extras.injuries ?? []) {
    const latest = [...(inj.updates ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest || !today) continue;
    const age = daysBetween(latest.date, today);
    if (age < 0 || age > R.INJURY_RECENT_DAYS) continue;
    const flags = (latest.red_flags ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    if (flags.length) {
      forcedRed = true;
      reasons.push(`${injuryName(inj)}: red flag (${flags.join(", ").replace(/_/g, " ")}): fully unload it today`);
    } else if (latest.trend === "worse") {
      points += 1;
      reasons.push(`${injuryName(inj)} getting worse: unload it, nothing hard on it`);
    }
  }

  // Check-in.
  if (checkin) {
    const parts: string[] = [];
    let p = 0;
    const add = (label: string, n: number) => ((p += n), parts.push(label));
    const { feeling, sleep_hours, sleep_quality, drinks } = checkin;
    if (feeling != null && feeling <= R.FEELING_VERY_LOW) add("feeling wrecked", 2);
    else if (feeling != null && feeling <= R.FEELING_LOW) add("low feeling", 1);
    if (sleep_hours != null && sleep_hours < R.SLEEP_VERY_SHORT_H) add(`very short sleep (${sleep_hours}h)`, 2);
    else if (sleep_hours != null && sleep_hours < R.SLEEP_SHORT_H) add(`short sleep (${sleep_hours}h)`, 1);
    if (sleep_quality != null && sleep_quality <= R.SLEEP_QUALITY_BAD) add("bad sleep", 1);
    if (drinks != null && drinks >= R.DRINKS_MANY) add(`${R.DRINKS_MANY}+ drinks yesterday`, 2);
    else if (drinks != null && drinks >= R.DRINKS_SOME) add(`${drinks} drinks yesterday`, 1);
    if (p > 0) {
      const action =
        p >= R.RED_POINTS ? "make it a rest or easy day" : p >= 2 ? "keep it short / skip the hard block" : "warm up well, cut it short if it feels off";
      reasons.push(`${parts.join(" + ")}: ${action}`);
      points += p;
    }
  }

  // Consecutive hard days.
  const streak = today ? hardStreak(recentSessions, today) : 0;
  if (streak >= R.HARD_STREAK) {
    points += streak >= R.HARD_STREAK_LONG ? 2 : 1;
    reasons.push(`${streak} hard days in a row: make today easy or rest`);
  }

  // Load vs baseline and vs plan.
  let loadPoints = 0;
  if (load && load.baseline_status !== "building") {
    const partial = load.baseline_status === "partial";
    const ratioCheck = (ratio: number | null, what: string, action: string) => {
      if (ratio === null || ratio <= R.RATIO_HIGH) return 0;
      reasons.push(
        partial
          ? `${what} looks well above your usual week (provisional, ${load.history_days} days of history): ${action}`
          : `${what} ${ratio}x your usual week: ${action}`,
      );
      return partial ? 1 : ratio > R.RATIO_VERY_HIGH ? 2 : 1;
    };
    loadPoints = Math.max(
      ratioCheck(load.ratio_total, "last 7 days' load", "hold back on volume"),
      ratioCheck(load.ratio_finger, "finger load", "skip board / max hangs, keep crimps easy"),
    );
  }
  const planned = today ? plannedLoad(extras.plan, today) : null;
  if (load && planned && load.last7.total > planned * R.PLAN_OVER) {
    loadPoints += 1;
    reasons.push(`last 7 days well above plan (load ${load.last7.total} vs ~${planned} planned): stay at or under plan today`);
  }
  points += Math.min(R.LOAD_MAX_POINTS, loadPoints);

  if (!checkin) reasons.push("no check-in yet: based on load and injuries only");

  const level: ReadinessLevel =
    forcedRed || points >= R.RED_POINTS ? "red" : points >= R.AMBER_POINTS ? "amber" : "green";
  return { level, reasons };
}
