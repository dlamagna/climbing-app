import { describe, expect, it } from "vitest";
import { type BaselineStatus, addDays } from "./load";
import { type PlanStatus, weekSummary } from "./plan";
import {
  type WeekCheckin,
  type WeekSummaryInput,
  computeWeekSummary,
  drinksText,
  fingerText,
  isEmptyWeek,
  mixText,
  sessionsText,
  sleepText,
} from "./weekSummary";

// Made-up sample data only. MONDAY is a Monday; TODAY is the Thursday of that week.
const MONDAY = "2026-05-18";
const TODAY = "2026-05-21";
const SUNDAY_BEFORE = addDays(MONDAY, -1);

const load = (status: BaselineStatus = "ok", thisWeek = 0, usual = 300, history = 60) => ({
  weeks: [
    { week_start: addDays(MONDAY, -7), total: 900, finger: 400, finger_raw: 380, sessions: 4 },
    { week_start: MONDAY, total: 500, finger: thisWeek, finger_raw: thisWeek, sessions: 2 },
  ],
  prev28_weekly_avg: { finger: usual },
  baseline_status: status,
  history_days: history,
});

const input = (over: Partial<WeekSummaryInput> = {}): WeekSummaryInput => ({
  today: TODAY,
  checkins: [],
  sessions: [],
  plan: [],
  load: load(),
  ...over,
});

const ci = (date: string, sleep_hours: number | null, sleep_quality: number | null, drinks: number | null): WeekCheckin => ({
  date,
  sleep_hours,
  sleep_quality,
  drinks,
});

describe("sleep", () => {
  it("averages hours and quality over the nights logged, skipping gaps rather than counting them as 0", () => {
    const w = computeWeekSummary(
      input({
        checkins: [
          ci(MONDAY, 7, 3, 0),
          // Tuesday: no check-in at all
          ci(addDays(MONDAY, 2), 6, null, 1), // quality missing
          ci(TODAY, null, 2, 0), // hours missing
        ],
      }),
    );
    expect(w.checkins).toBe(3);
    expect(w.sleep).toEqual({ nights: 2, avg_hours: 6.5, avg_quality: 2.5 });
    expect(sleepText(w.sleep)).toBe("6.5h avg · quality Good (2.5/3)");
  });

  it("rounds to one decimal and has no text without check-ins", () => {
    const w = computeWeekSummary(input({ checkins: [ci(MONDAY, 7, 2, 0), ci(TODAY, 7.5, 2, 0), ci(addDays(MONDAY, 1), 8, 1, 0)] }));
    expect(w.sleep.avg_hours).toBe(7.5);
    expect(w.sleep.avg_quality).toBe(1.7);
    expect(sleepText(w.sleep)).toBe("7.5h avg · quality OK (1.7/3)");

    const empty = computeWeekSummary(input());
    expect(empty.sleep).toEqual({ nights: 0, avg_hours: null, avg_quality: null });
    expect(sleepText(empty.sleep)).toBeNull();
  });
});

describe("drinks", () => {
  it("totals the drinks of the check-ins dated this week", () => {
    const w = computeWeekSummary(input({ checkins: [ci(MONDAY, 7, 2, 2), ci(addDays(MONDAY, 1), 7, 2, null), ci(TODAY, 7, 2, 1)] }));
    expect(w.drinks).toEqual({ total: 3, days_logged: 2, capped: false });
    expect(drinksText(w.drinks)).toBe("3");
  });

  it("marks the total as a minimum when a day was 5+", () => {
    const w = computeWeekSummary(input({ checkins: [ci(MONDAY, 7, 2, 5), ci(TODAY, 7, 2, 1)] }));
    expect(drinksText(w.drinks)).toBe("6+");
  });

  it("shows 0 for logged dry days and nothing when no drinks were logged", () => {
    expect(drinksText(computeWeekSummary(input({ checkins: [ci(MONDAY, 7, 2, 0)] })).drinks)).toBe("0");
    expect(drinksText(computeWeekSummary(input()).drinks)).toBeNull();
  });
});

describe("Monday boundary", () => {
  const checkins = [ci(SUNDAY_BEFORE, 4, 1, 5), ci(MONDAY, 8, 3, 1)];
  const sessions = [
    { date: SUNDAY_BEFORE, type: "lead", duration_min: 120, rpe: 7 },
    { date: MONDAY, type: "boulder", duration_min: 60, rpe: 7 },
  ];

  it("leaves Sunday out and counts Monday in", () => {
    const w = computeWeekSummary(input({ checkins, sessions }));
    expect(w.week_start).toBe(MONDAY);
    expect(w.days).toBe(4);
    expect(w.sleep.avg_hours).toBe(8);
    expect(w.drinks.total).toBe(1);
    expect(w.sessions.logged).toBe(1);
    expect(w.mix.rope_min).toBe(0);
  });

  it("starts a fresh week on Monday itself and still belongs to last week on Sunday", () => {
    const monday = computeWeekSummary(input({ today: MONDAY, checkins, sessions }));
    expect(monday.week_start).toBe(MONDAY);
    expect(monday.days).toBe(1);
    expect(monday.checkins).toBe(1);

    const sunday = computeWeekSummary(input({ today: SUNDAY_BEFORE, checkins, sessions, load: load("ok", 0) }));
    expect(sunday.week_start).toBe(addDays(MONDAY, -7));
    expect(sunday.days).toBe(7);
    expect(sunday.sleep.avg_hours).toBe(4);
    expect(sunday.drinks.total).toBe(5);
    expect(sunday.mix.rope_min).toBe(120);
    expect(sunday.finger.this_week).toBe(400); // last week's row
  });

  it("ignores rows after today", () => {
    const w = computeWeekSummary(input({ checkins: [ci(addDays(TODAY, 1), 9, 3, 4)] }));
    expect(w.checkins).toBe(0);
  });
});

describe("finger load vs usual", () => {
  it("says building baseline instead of comparing", () => {
    const w = computeWeekSummary(input({ load: load("building", 120, 0, 9) }));
    expect(w.finger).toEqual({ this_week: 120, usual_weekly: null, baseline_status: "building", history_days: 9 });
    expect(fingerText(w.finger)).toBe("120 · building baseline");
  });

  it("compares but marks it provisional while partial", () => {
    const w = computeWeekSummary(input({ load: load("partial", 150, 300, 20) }));
    expect(fingerText(w.finger)).toBe("150 · 50% of a usual week (~300) (provisional)");
  });

  it("compares this week so far with the usual week once the baseline is ok", () => {
    const w = computeWeekSummary(input({ load: load("ok", 330, 300) }));
    expect(w.finger.usual_weekly).toBe(300);
    expect(fingerText(w.finger)).toBe("330 · 110% of a usual week (~300)");
  });

  it("has nothing to compare with when the weeks before had no finger load", () => {
    expect(fingerText(computeWeekSummary(input({ load: load("ok", 80, 0) })).finger)).toBe("80 · none in the weeks before");
  });

  it("is 0 when this week has no load row yet", () => {
    const w = computeWeekSummary(input({ load: { ...load(), weeks: [] } }));
    expect(w.finger.this_week).toBe(0);
  });
});

describe("climbing mix", () => {
  it("splits rope and boulder minutes and share, ignoring non-climbing types", () => {
    const w = computeWeekSummary(
      input({
        sessions: [
          { date: MONDAY, type: "lead", duration_min: 90, rpe: 6 },
          { date: addDays(MONDAY, 1), type: "board", duration_min: 40, rpe: 8 },
          { date: TODAY, type: "boulder", duration_min: 20, rpe: 7 },
          { date: TODAY, type: "hangboard", duration_min: 30, rpe: 7 },
        ],
      }),
    );
    expect(w.mix).toEqual({ rope_min: 90, boulder_min: 60, rope_share: 60, boulder_share: 40 });
    expect(mixText(w.mix)).toBe("Rope 1h 30m (60%) · Boulder 1h (40%)");
    expect(w.sessions.logged).toBe(4);
  });

  it("has no shares and no text with zero climbing", () => {
    const w = computeWeekSummary(input({ sessions: [{ date: MONDAY, type: "strength", duration_min: 45, rpe: 6 }] }));
    expect(w.mix).toEqual({ rope_min: 0, boulder_min: 0, rope_share: null, boulder_share: null });
    expect(mixText(w.mix)).toBeNull();
  });
});

describe("sessions done vs planned", () => {
  const entry = (date: string, type: string | null, status: PlanStatus, intensity: string | null = null) => ({
    date,
    type,
    intensity,
    status,
  });
  const plan = [
    entry(addDays(MONDAY, -2), "boulder", "skipped"), // last week
    entry(MONDAY, "boulder", "done"),
    entry(addDays(MONDAY, 1), "rest", "swapped"), // trained on a rest day
    entry(addDays(MONDAY, 2), "strength", "skipped"),
    entry(TODAY, "lead", "planned"),
    entry(addDays(MONDAY, 5), "rest", "planned"),
    entry(addDays(MONDAY, 6), "hangboard", "planned"),
  ];

  it("passes plan.ts's week-so-far counts through unchanged", () => {
    const w = computeWeekSummary(input({ plan, sessions: [{ date: MONDAY, type: "boulder", duration_min: 60, rpe: 7 }] }));
    expect(w.sessions.so_far).toEqual(weekSummary(plan, TODAY));
    expect(w.sessions.so_far).toMatchObject({ done: 1, swapped: 1, skipped: 1, planned: 1, partial: 0 });
    expect(w.sessions.planned_this_week).toBe(4); // non-rest entries Monday to Sunday
    expect(sessionsText(w.sessions)).toBe("1 logged · 1 of 4 planned done, 1 swapped, 1 skipped");
  });

  it("says when there is no plan this week", () => {
    const w = computeWeekSummary(input({ sessions: [{ date: MONDAY, type: "boulder", duration_min: 60, rpe: 7 }] }));
    expect(sessionsText(w.sessions)).toBe("1 logged · no plan");
  });

  it("skips plan entries without a status", () => {
    const w = computeWeekSummary(input({ plan: [{ date: MONDAY, type: "boulder", intensity: null }] }));
    expect(w.sessions.so_far.done + w.sessions.so_far.skipped).toBe(0);
    expect(w.sessions.planned_this_week).toBe(1);
  });
});

describe("empty week", () => {
  it("is empty on a Monday morning with nothing logged or planned", () => {
    const w = computeWeekSummary(input({ today: MONDAY }));
    expect(isEmptyWeek(w)).toBe(true);
    expect(sessionsText(w.sessions)).toBe("0 logged · no plan");
  });

  it("is not empty once there is a check-in or a plan", () => {
    expect(isEmptyWeek(computeWeekSummary(input({ checkins: [ci(MONDAY, 7, 2, 0)] })))).toBe(false);
    expect(isEmptyWeek(computeWeekSummary(input({ plan: [{ date: TODAY, type: "lead", intensity: null, status: "planned" }] })))).toBe(false);
  });
});
