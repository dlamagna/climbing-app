// Plan vs actual (#21): matches logged sessions to plan entries, derives a status per entry, flags
// conflicts for the coming days and sums up the week. Pure functions with no D1, so they can be unit
// tested (plan.test.ts) and imported by the app.
//
// Design: nothing here is stored. Statuses and links are derived at read time from the plan and sessions
// rows, so a session logged two days late, edited (new date or type), deleted, replayed from the offline
// outbox or written via MCP shows up on the next read without any re-matching step to forget. The only
// stored state is what the climber or coach chose explicitly:
//   - plan.status_override: a status picked by hand in the app (NULL = automatic)
//   - sessions.plan_id: a pinned link ("this session was that planned entry"), e.g. a planned session done
//     on another day. NULL = auto-match by date. Pinned sessions are never auto-matched elsewhere.

import { addDays, mondayOf } from "./load";

export const PLAN_STATUSES = ["planned", "done", "partial", "skipped", "swapped"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const isPlanStatus = (s: unknown): s is PlanStatus => PLAN_STATUSES.includes(s as PlanStatus);

// --- Thresholds, all in one place -------------------------------------------------------------------
// A matched session (plus same-type extras that day) under this share of the entry's duration_min is "partial".
export const PARTIAL_FRACTION = 0.6;
// A day is hard when any session has effort >= HARD_RPE or the day's load (min x rpe) reaches HARD_DAY_LOAD
// (e.g. 2 h at effort 5).
export const HARD_RPE = 8;
export const HARD_DAY_LOAD = 600;
// Training on a rest day up to this load (e.g. 40 min of mobility at effort 3) is still "swapped" but not
// flagged as a conflict.
export const REST_DAY_EASY_LOAD = 120;
// How far back an event can be and still raise a conflict for the coming days.
export const REST_DAY_LOOKBACK_DAYS = 2; // fatigue from training on a rest day
export const KEY_MISSED_LOOKBACK_DAYS = 6; // a strength / test day that didn't happen (to reschedule it)

// Types that stand in for each other when choosing which planned entry a session belongs to. Only used
// for matching: the status is "done" for the exact type and "swapped" for anything else (board instead of
// boulder included); the climber can override it with one tap.
export const TYPE_GROUPS: string[][] = [
  ["boulder", "board", "lead", "toprope"],
  ["strength", "hangboard"],
];

// 3 same type, 2 same group, 1 the entry has no type (any session fits), 0 different.
export function typeSimilarity(planned: string | null | undefined, actual: string): number {
  if (!planned) return 1;
  if (planned === actual) return 3;
  return TYPE_GROUPS.some((g) => g.includes(planned) && g.includes(actual)) ? 2 : 0;
}

export interface PlanRow {
  id: number;
  date: string;
  title: string;
  type: string | null;
  intensity: string | null;
  duration_min?: number | null;
  status_override?: string | null;
  expected_benchmarks?: { name: string }[] | null; // decoded list (worker/benchmarks.ts)
}

export interface SessionRow {
  id: number;
  date: string;
  type: string;
  duration_min: number;
  rpe: number;
  plan_id?: number | null;
  gym?: string | null; // #48, read by the weekly summary
}

export const isRestEntry = (e: Pick<PlanRow, "type" | "intensity">) =>
  e.type === "rest" || (!e.type && e.intensity === "rest");

// Strength days and test days are the ones worth rescheduling when missed. A test day is one with
// expected_benchmarks (#22) or, for entries written before those existed, a test-sounding title.
export const isKeyEntry = (e: PlanRow) =>
  !isRestEntry(e) &&
  (e.type === "strength" || Boolean(e.expected_benchmarks?.length) || /\b(test|benchmark|baseline|assess)/i.test(e.title));

const load = (s: Pick<SessionRow, "duration_min" | "rpe">) => s.duration_min * s.rpe;

// Plan entry id -> session id. Pinned links first (a pin to a rest entry is ignored); then, per date, every (entry, session) pair is ranked
// by type similarity (ties: longer session first, then lower ids) and taken greedily, so each entry gets
// at most one session and each session at most one entry. A session of an unrelated type still matches a
// free entry that day (that entry is then "swapped"). Rest entries take no session.
export function matchSessions(entries: PlanRow[], sessions: SessionRow[]): Map<number, number> {
  const links = new Map<number, number>();
  const pinnable = new Set(entries.filter((e) => !isRestEntry(e)).map((e) => e.id));
  for (const s of [...sessions].sort((a, b) => a.id - b.id)) {
    if (s.plan_id != null && pinnable.has(s.plan_id) && !links.has(s.plan_id)) links.set(s.plan_id, s.id);
  }
  const taken = new Set(links.values());
  const free = sessions.filter((s) => s.plan_id == null);
  const pairs = entries
    .filter((e) => !isRestEntry(e) && !links.has(e.id))
    .flatMap((e) => free.filter((s) => s.date === e.date).map((s) => ({ e, s, score: typeSimilarity(e.type, s.type) })));
  pairs.sort(
    (a, b) => b.score - a.score || b.s.duration_min - a.s.duration_min || a.e.id - b.e.id || a.s.id - b.s.id,
  );
  for (const { e, s } of pairs) {
    if (links.has(e.id) || taken.has(s.id)) continue;
    links.set(e.id, s.id);
    taken.add(s.id);
  }
  return links;
}

export interface StatusFields {
  status: PlanStatus; // status_override if set, else auto_status
  auto_status: PlanStatus;
  session_id: number | null; // matched session (for a swapped rest day: the session done on it)
}

// Automatic status, before any override:
// - rest entry: swapped if a session not matched to another entry was logged that day; done once the day
//   has passed; planned until then
// - matched session: done if pinned, same type, or the entry has no type (partial if under PARTIAL_FRACTION
//   of a known duration_min); swapped if a different type
// - nothing matched: skipped once the day has passed (today is never skipped yet), planned otherwise
export function planStatuses<T extends PlanRow>(entries: T[], sessions: SessionRow[], today: string): (T & StatusFields)[] {
  const links = matchSessions(entries, sessions);
  const linked = new Set(links.values());
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const unlinked = sessions.filter((s) => !linked.has(s.id));

  const auto = (e: T): [PlanStatus, number | null] => {
    if (isRestEntry(e)) {
      const s = unlinked.find((x) => x.date === e.date);
      if (s) return ["swapped", s.id];
      return [e.date < today ? "done" : "planned", null];
    }
    const s = byId.get(links.get(e.id)!);
    if (!s) return [e.date < today ? "skipped" : "planned", null];
    if (s.plan_id !== e.id && e.type && e.type !== s.type) return ["swapped", s.id];
    if (e.duration_min && e.duration_min > 0) {
      const extras = unlinked.filter((x) => x.date === s.date && x.type === s.type);
      const total = s.duration_min + extras.reduce((acc, x) => acc + x.duration_min, 0);
      if (total < PARTIAL_FRACTION * e.duration_min) return ["partial", s.id];
    }
    return ["done", s.id];
  };

  return entries.map((e) => {
    const [auto_status, session_id] = auto(e);
    const status = isPlanStatus(e.status_override) ? e.status_override : auto_status;
    return { ...e, status, auto_status, session_id };
  });
}

export type ConflictKind = "rest_day_session" | "hard_before_hard" | "key_session_missed";

export interface PlanConflict {
  kind: ConflictKind;
  date: string; // when it happened
  entry_id: number; // the plan entry it concerns (the rest day, the planned hard day, the missed entry)
  title: string; // that entry's title
  session_ids: number[];
  flag_date: string | null; // the next planned day it affects; null if nothing is planned yet
  flag_entry_id: number | null; // the entry the app shows the flag on
  message: string;
}

export function isHardDay(daySessions: Pick<SessionRow, "duration_min" | "rpe">[]): boolean {
  return (
    daySessions.some((s) => s.rpe >= HARD_RPE) || daySessions.reduce((acc, s) => acc + load(s), 0) >= HARD_DAY_LOAD
  );
}

// Conflicts between what happened and what is planned next:
// - rest_day_session: more than REST_DAY_EASY_LOAD on a planned rest day in the last REST_DAY_LOOKBACK_DAYS
// - hard_before_hard: a hard day (today or yesterday) that wasn't planned hard, right before a planned hard day
// - key_session_missed: a strength / test day skipped or swapped in the last KEY_MISSED_LOOKBACK_DAYS
// Each is flagged on the next day (from today on) with a non-rest entry still "planned".
export function planConflicts(statuses: (PlanRow & StatusFields)[], sessions: SessionRow[], today: string): PlanConflict[] {
  const sorted = [...statuses].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const onDay = (d: string) => sessions.filter((s) => s.date === d);
  const nextPlanned = (after: string) =>
    sorted.find((e) => e.date > after && e.date >= today && !isRestEntry(e) && e.status === "planned") ?? null;
  const conflicts: PlanConflict[] = [];
  const add = (c: Omit<PlanConflict, "flag_date" | "flag_entry_id">, flag = nextPlanned(c.date)) =>
    conflicts.push({ ...c, flag_date: flag?.date ?? null, flag_entry_id: flag?.id ?? null });

  const restDays = new Set<string>();
  for (const e of sorted) {
    if (!isRestEntry(e) || e.status !== "swapped" || e.date < addDays(today, -REST_DAY_LOOKBACK_DAYS) || e.date > today) continue;
    if (restDays.has(e.date)) continue;
    const day = onDay(e.date);
    const dayLoad = day.reduce((acc, s) => acc + load(s), 0);
    if (dayLoad <= REST_DAY_EASY_LOAD) continue;
    restDays.add(e.date);
    add({
      kind: "rest_day_session",
      date: e.date,
      entry_id: e.id,
      title: e.title,
      session_ids: day.map((s) => s.id),
      message: `Trained on a planned rest day (${e.date}, load ${dayLoad}).`,
    });
  }

  for (const d of [addDays(today, -1), today]) {
    const day = onDay(d);
    if (!day.length || !isHardDay(day)) continue;
    if (sorted.some((e) => e.date === d && e.intensity === "hard")) continue; // the plan already had it hard
    const next = sorted.find((e) => e.date === addDays(d, 1) && e.intensity === "hard" && e.status === "planned");
    if (!next) continue;
    add(
      {
        kind: "hard_before_hard",
        date: d,
        entry_id: next.id,
        title: next.title,
        session_ids: day.map((s) => s.id),
        message: `Hard day on ${d} (not planned hard) right before the planned hard day "${next.title}" on ${next.date}.`,
      },
      next,
    );
  }

  for (const e of sorted) {
    if (!isKeyEntry(e) || (e.status !== "skipped" && e.status !== "swapped")) continue;
    if (e.date < addDays(today, -KEY_MISSED_LOOKBACK_DAYS) || e.date > today) continue;
    add({
      kind: "key_session_missed",
      date: e.date,
      entry_id: e.id,
      title: e.title,
      session_ids: e.session_id ? [e.session_id] : [],
      message: `"${e.title}" on ${e.date} was ${e.status}; consider rescheduling it.`,
    });
  }

  return conflicts.sort((a, b) => a.date.localeCompare(b.date));
}

// Entries with their status and the conflicts flagged on them, plus every conflict (including those with
// no planned day to show them on).
export function planView<T extends PlanRow>(entries: T[], sessions: SessionRow[], today: string) {
  const statuses = planStatuses(entries, sessions, today);
  const conflicts = planConflicts(statuses, sessions, today);
  return {
    entries: statuses.map((e) => ({ ...e, flags: conflicts.filter((c) => c.flag_entry_id === e.id) })),
    conflicts,
  };
}

export interface WeekSummary {
  week_start: string;
  done: number;
  partial: number;
  skipped: number;
  swapped: number;
  planned: number; // still to do today
}

// Monday to today. Rest days taken as planned aren't counted; a rest day trained on counts as swapped.
export function weekSummary(entries: Pick<PlanRow & StatusFields, "date" | "type" | "intensity" | "status">[], today: string): WeekSummary {
  const week_start = mondayOf(today);
  const sum: WeekSummary = { week_start, done: 0, partial: 0, skipped: 0, swapped: 0, planned: 0 };
  for (const e of entries) {
    if (e.date < week_start || e.date > today) continue;
    if (isRestEntry(e) && (e.status === "done" || e.status === "planned")) continue;
    sum[e.status]++;
  }
  return sum;
}

// "This week so far: 2 done, 1 swapped, 2 skipped", or null before anything has happened.
export function weekSummaryText(s: WeekSummary): string | null {
  const parts = (["done", "partial", "swapped", "skipped"] as const).filter((k) => s[k] > 0).map((k) => `${s[k]} ${k}`);
  return parts.length ? `This week so far: ${parts.join(", ")}` : null;
}

export interface AdherenceDay {
  date: string;
  entries: { id: number; title: string; type: string | null; intensity: string | null; status: PlanStatus; auto_status: PlanStatus; session_id: number | null }[];
  unplanned_session_ids: number[]; // sessions that day matched to no entry
}

// One row per day from `from` to `to` that has a plan entry or a session.
export function adherence(statuses: (PlanRow & StatusFields)[], sessions: SessionRow[], from: string, to: string): AdherenceDay[] {
  const matched = new Set(statuses.map((e) => e.session_id).filter((id) => id !== null));
  const days: AdherenceDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const entries = statuses
      .filter((e) => e.date === d)
      .map(({ id, title, type, intensity, status, auto_status, session_id }) => ({ id, title, type, intensity, status, auto_status, session_id }));
    const unplanned = sessions.filter((s) => s.date === d && !matched.has(s.id)).map((s) => s.id);
    if (entries.length || unplanned.length) days.push({ date: d, entries, unplanned_session_ids: unplanned });
  }
  return days;
}
