// Session type groups (#32): the ONLY place that says which session type counts as rope, boulder, fingers
// or other. Pure (no DOM, no D1), shared by the worker (get_overview's mix) and the app (History calendar,
// mix summary, weekly by-type chart; src/types.ts re-exports it). Unit tested in typeGroups.test.ts.

import { addDays } from "./load";

export const TYPE_GROUPS = [
  // "toprope" joins lead here once #33 adds that type.
  { key: "rope", label: "Rope", letter: "R", types: ["lead"] },
  { key: "boulder", label: "Boulder", letter: "B", types: ["boulder", "board"] },
  { key: "fingers", label: "Fingers", letter: "F", types: ["hangboard"] },
  { key: "other", label: "Other", letter: "O", types: ["strength", "cardio", "mobility", "other"] },
] as const;

export type GroupKey = (typeof TYPE_GROUPS)[number]["key"];

export const GROUP_KEYS: GroupKey[] = TYPE_GROUPS.map((g) => g.key);

// Groups whose time counts as climbing time, the base of the climbing share.
export const CLIMBING_GROUPS = ["rope", "boulder"] as const satisfies readonly GroupKey[];
export type ClimbingGroup = (typeof CLIMBING_GROUPS)[number];

// Unknown types (an old or future value) fall into "other" rather than disappearing from totals.
export function groupOf(type: string | null | undefined): GroupKey {
  return TYPE_GROUPS.find((g) => (g.types as readonly string[]).includes(type ?? ""))?.key ?? "other";
}

export const groupInfo = (key: GroupKey) => TYPE_GROUPS.find((g) => g.key === key)!;

export interface MixSession {
  date?: string;
  type: string;
  duration_min: number;
  rpe: number;
}

export interface GroupTotals {
  minutes: number;
  load: number; // duration_min * rpe
  sessions: number;
}

export type Mix = Record<GroupKey, GroupTotals>;

export function emptyMix(): Mix {
  return Object.fromEntries(GROUP_KEYS.map((k) => [k, { minutes: 0, load: 0, sessions: 0 }])) as Mix;
}

// Minutes, load and session count per group.
export function groupMix(sessions: readonly MixSession[]): Mix {
  const mix = emptyMix();
  for (const s of sessions) {
    const g = mix[groupOf(s.type)];
    g.minutes += s.duration_min || 0;
    g.load += (s.duration_min || 0) * (s.rpe || 0);
    g.sessions += 1;
  }
  return mix;
}

export const climbingMinutes = (mix: Mix) => CLIMBING_GROUPS.reduce((acc, k) => acc + mix[k].minutes, 0);

// Each climbing group's share of climbing time in whole percent, summing to 100; null when there was
// no climbing time at all (rather than NaN or a misleading 0%).
export function climbingShares(mix: Mix): Record<ClimbingGroup, number | null> {
  const total = climbingMinutes(mix);
  if (total <= 0) return { rope: null, boulder: null };
  const rope = Math.round((mix.rope.minutes / total) * 100);
  return { rope, boulder: 100 - rope };
}

// Sessions dated from..to inclusive (YYYY-MM-DD strings compare in date order).
export const inRange = <T extends { date?: string }>(rows: readonly T[], from: string, to: string) =>
  rows.filter((r) => r.date !== undefined && r.date >= from && r.date <= to);

// get_overview's mix: per group, the last 7 and the last 28 days, both ending today.
export function mixWindows(sessions: readonly MixSession[], today: string) {
  return {
    last7: groupMix(inRange(sessions, addDays(today, -6), today)),
    last28: groupMix(inRange(sessions, addDays(today, -27), today)),
  };
}

// One Mix per week, for weeks starting on the given dates (Monday-aligned in practice).
export function mixByWeek(sessions: readonly MixSession[], weekStarts: readonly string[]): Mix[] {
  return weekStarts.map((start) => groupMix(inRange(sessions, start, addDays(start, 6))));
}

// "45m", "6h", "6h 10m".
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}
