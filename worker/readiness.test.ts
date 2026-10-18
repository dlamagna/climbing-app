import { describe, expect, it } from "vitest";
import { HARD_DAY_LOAD, HARD_RPE } from "./plan";
import {
  READINESS as R,
  type ReadinessCheckin,
  type ReadinessLoad,
  type ReadinessSession,
  hardStreak,
  isHardSession,
  plannedLoad,
  readiness,
} from "./readiness";

// Made-up data only.
const TODAY = "2026-05-14";
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const GOOD: ReadinessCheckin = { date: TODAY, feeling: 4, sleep_hours: 8, sleep_quality: 3, drinks: 0 };
const checkin = (c: ReadinessCheckin) => ({ ...GOOD, ...c });

const load = (over: Partial<ReadinessLoad> = {}): ReadinessLoad => ({
  last7: { total: 1000, finger: 600, finger_raw: 600 },
  prev28_weekly_avg: { total: 1000, finger: 600, finger_raw: 600 },
  ratio_total: 1,
  ratio_finger: 1,
  baseline_status: "ok",
  history_days: 60,
  ...over,
});

const easy = (date: string): ReadinessSession => ({ date, duration_min: 60, rpe: 4 });
const hard = (date: string): ReadinessSession => ({ date, duration_min: 60, rpe: HARD_RPE });

const run = (c: ReadinessCheckin | null, opts: { load?: ReadinessLoad; sessions?: ReadinessSession[]; extras?: object } = {}) =>
  readiness(c, opts.load ?? load(), opts.sessions ?? [], { today: TODAY, ...opts.extras });

describe("readiness: check-in thresholds", () => {
  it("is green with no reasons on a normal day", () => {
    expect(run(GOOD)).toEqual({ level: "green", reasons: [] });
  });

  it("feeling: low at FEELING_LOW, not above; wrecked counts double", () => {
    expect(run(checkin({ feeling: R.FEELING_LOW + 1 })).level).toBe("green");
    const low = run(checkin({ feeling: R.FEELING_LOW }));
    expect(low.level).toBe("amber");
    expect(low.reasons[0]).toMatch(/^low feeling: /);
    expect(run(checkin({ feeling: R.FEELING_VERY_LOW })).reasons[0]).toMatch(/^feeling wrecked: keep it short/);
  });

  it("sleep hours: short below SLEEP_SHORT_H, very short below SLEEP_VERY_SHORT_H", () => {
    expect(run(checkin({ sleep_hours: R.SLEEP_SHORT_H })).level).toBe("green");
    expect(run(checkin({ sleep_hours: R.SLEEP_SHORT_H - 0.5 })).reasons).toEqual([
      "short sleep (5.5h): warm up well, cut it short if it feels off",
    ]);
    expect(run(checkin({ sleep_hours: R.SLEEP_VERY_SHORT_H })).reasons[0]).toMatch(/^short sleep/);
    expect(run(checkin({ sleep_hours: R.SLEEP_VERY_SHORT_H - 0.5 })).reasons[0]).toMatch(/^very short sleep \(4.5h\): keep it short/);
  });

  it("sleep quality: bad at SLEEP_QUALITY_BAD only", () => {
    expect(run(checkin({ sleep_quality: R.SLEEP_QUALITY_BAD + 1 })).level).toBe("green");
    expect(run(checkin({ sleep_quality: R.SLEEP_QUALITY_BAD })).reasons[0]).toMatch(/^bad sleep:/);
  });

  it("drinks: from DRINKS_SOME, double from DRINKS_MANY", () => {
    expect(run(checkin({ drinks: R.DRINKS_SOME - 1 })).level).toBe("green");
    expect(run(checkin({ drinks: R.DRINKS_SOME })).reasons[0]).toMatch(/^3 drinks yesterday: warm up/);
    expect(run(checkin({ drinks: R.DRINKS_MANY })).reasons[0]).toMatch(/^5\+ drinks yesterday: keep it short/);
  });

  it("skips missing fields", () => {
    expect(run({ date: TODAY, feeling: null, sleep_hours: null, sleep_quality: null, drinks: null })).toEqual({
      level: "green",
      reasons: [],
    });
  });
});

describe("readiness: combinations", () => {
  it("low feeling + drinks yesterday is one amber reason with an action hint", () => {
    expect(run(checkin({ feeling: 2, drinks: 3 }))).toEqual({
      level: "amber",
      reasons: ["low feeling + 3 drinks yesterday: keep it short / skip the hard block"],
    });
  });

  it("enough check-in points make it red", () => {
    const r = run(checkin({ feeling: 2, drinks: 3, sleep_hours: 5.5 }));
    expect(r.level).toBe("red");
    expect(r.reasons).toEqual(["low feeling + short sleep (5.5h) + 3 drinks yesterday: make it a rest or easy day"]);
    expect(run(checkin({ feeling: 1, drinks: 5 })).level).toBe("red");
  });

  it("check-in plus hard days plus load add up to red", () => {
    const r = run(checkin({ feeling: 2 }), { sessions: [hard(day(-1)), hard(day(-2))], load: load({ ratio_total: 1.4 }) });
    expect(r.level).toBe("red");
    expect(r.reasons).toHaveLength(3);
  });
});

describe("readiness: consecutive hard days", () => {
  it("counts back from yesterday using plan.ts's hard-day definition", () => {
    expect(hardStreak([hard(day(-1)), hard(day(-2)), easy(day(-3)), hard(day(-4))], TODAY)).toBe(2);
    expect(hardStreak([hard(TODAY), easy(day(-1))], TODAY)).toBe(0); // today doesn't count
    // Two easy sessions that together reach HARD_DAY_LOAD make a hard day.
    const long = (date: string): ReadinessSession => ({ date, duration_min: HARD_DAY_LOAD / 5 / 2, rpe: 5 });
    expect(hardStreak([long(day(-1)), long(day(-1))], TODAY)).toBe(1);
  });

  it("HARD_STREAK days is amber, HARD_STREAK_LONG still amber alone, red with another signal", () => {
    expect(run(GOOD, { sessions: [hard(day(-1))] }).level).toBe("green");
    expect(run(GOOD, { sessions: [hard(day(-1)), hard(day(-2))] })).toEqual({
      level: "amber",
      reasons: ["2 hard days in a row: make today easy or rest"],
    });
    const three = [hard(day(-1)), hard(day(-2)), hard(day(-3))];
    expect(run(GOOD, { sessions: three }).level).toBe("amber");
    expect(run(checkin({ feeling: 2 }), { sessions: three }).level).toBe("red");
  });

  it("isHardSession follows HARD_RPE and HARD_DAY_LOAD", () => {
    expect(isHardSession({ duration_min: 30, rpe: HARD_RPE })).toBe(true);
    expect(isHardSession({ duration_min: 30, rpe: HARD_RPE - 1 })).toBe(false);
    expect(isHardSession({ duration_min: HARD_DAY_LOAD / 5, rpe: 5 })).toBe(true);
    expect(isHardSession({ duration_min: HARD_DAY_LOAD / 5 - 1, rpe: 5 })).toBe(false);
  });
});

describe("readiness: load vs baseline", () => {
  it("ratio boundaries with an ok baseline", () => {
    expect(run(GOOD, { load: load({ ratio_total: R.RATIO_HIGH }) }).level).toBe("green");
    expect(run(GOOD, { load: load({ ratio_total: 1.4 }) }).reasons).toEqual([
      "last 7 days' load 1.4x your usual week: hold back on volume",
    ]);
    // 2 points: amber alone (load is capped below red), red with one more signal.
    expect(run(GOOD, { load: load({ ratio_total: 1.6 }) }).level).toBe("amber");
    expect(run(GOOD, { load: load({ ratio_total: R.RATIO_VERY_HIGH }) }).level).toBe("amber");
    expect(run(checkin({ feeling: 2 }), { load: load({ ratio_total: 1.6 }) }).level).toBe("red");
    expect(run(checkin({ feeling: 2 }), { load: load({ ratio_total: R.RATIO_VERY_HIGH }) }).level).toBe("amber");
  });

  it("finger ratio has its own reason", () => {
    const r = run(GOOD, { load: load({ ratio_finger: 1.5 }) });
    expect(r.level).toBe("amber");
    expect(r.reasons[0]).toMatch(/^finger load 1.5x your usual week: skip board/);
  });

  it("no ratio reasons while building", () => {
    expect(run(GOOD, { load: load({ baseline_status: "building", history_days: 9, ratio_total: 3, ratio_finger: 3 }) })).toEqual({
      level: "green",
      reasons: [],
    });
  });

  it("partial: softer wording and at most 1 point per ratio", () => {
    const partial = load({ baseline_status: "partial", history_days: 20, ratio_total: 2 });
    const r = run(GOOD, { load: partial });
    expect(r.reasons).toEqual([
      "last 7 days' load looks well above your usual week (provisional, 20 days of history): hold back on volume",
    ]);
    expect(run(checkin({ feeling: 2 }), { load: partial }).level).toBe("amber"); // 1 + 1, not red
    expect(run(checkin({ feeling: 2 }), { load: load({ ratio_total: 2 }) }).level).toBe("red"); // ok baseline: 1 + 2
  });
});

describe("readiness: load vs plan", () => {
  const plan = [
    { date: day(-5), type: "boulder", intensity: "hard", duration_min: 60 }, // 480
    { date: day(-3), type: "rest", intensity: "rest", duration_min: null },
    { date: day(-1), type: "strength", intensity: "moderate", duration_min: 60 }, // 300
    { date: day(-9), type: "boulder", intensity: "hard", duration_min: 600 }, // outside the window
  ];

  it("estimates planned load only from a complete plan", () => {
    expect(plannedLoad(plan, TODAY)).toBe(780);
    expect(plannedLoad([...plan, { date: day(-2), type: "lead", intensity: "easy", duration_min: null }], TODAY)).toBeNull();
    expect(plannedLoad([...plan, { date: day(-2), type: "lead", intensity: null, duration_min: 60 }], TODAY)).toBeNull();
    expect(plannedLoad([], TODAY)).toBeNull();
  });

  it("flags last 7 days above PLAN_OVER x plan, even while the baseline is building", () => {
    const building = (total: number) => load({ baseline_status: "building", history_days: 8, ratio_total: null, ratio_finger: null, last7: { total, finger: 0, finger_raw: 0 } });
    expect(run(GOOD, { load: building(Math.floor(780 * R.PLAN_OVER)), extras: { plan } }).level).toBe("green");
    expect(run(GOOD, { load: building(1100), extras: { plan } })).toEqual({
      level: "amber",
      reasons: ["last 7 days well above plan (load 1100 vs ~780 planned): stay at or under plan today"],
    });
  });

  it("ratio and plan together stay capped at LOAD_MAX_POINTS", () => {
    const high = load({ ratio_total: 1.6, last7: { total: 1600, finger: 0, finger_raw: 0 } });
    const r = run(GOOD, { load: high, extras: { plan } });
    expect(r.reasons).toHaveLength(2);
    expect(r.level).toBe("amber");
  });
});

describe("readiness: injuries", () => {
  const injury = (update: { date: string; trend?: string | null; red_flags?: string | null }) => ({
    body_part: "finger",
    side: "left",
    updates: [update, { date: day(-5), trend: "same", red_flags: null }],
  });

  it("worse trend in the latest update makes it at least amber", () => {
    const r = run(GOOD, { extras: { injuries: [injury({ date: TODAY, trend: "worse" })] } });
    expect(r).toEqual({ level: "amber", reasons: ["finger (left) getting worse: unload it, nothing hard on it"] });
  });

  it("any red flag makes it red", () => {
    const r = run(GOOD, { extras: { injuries: [injury({ date: day(-1), trend: "better", red_flags: "swelling,night_pain" })] } });
    expect(r).toEqual({ level: "red", reasons: ["finger (left): red flag (swelling, night pain): fully unload it today"] });
  });

  it("only the latest update counts, and only if recent", () => {
    const older = { body_part: "elbow", updates: [{ date: day(-1), trend: "better" }, { date: day(-2), trend: "worse", red_flags: "swelling" }] };
    expect(run(GOOD, { extras: { injuries: [older] } }).level).toBe("green");
    const stale = injury({ date: day(-(R.INJURY_RECENT_DAYS + 1)), trend: "worse", red_flags: "numbness" });
    expect(run(GOOD, { extras: { injuries: [stale] } }).level).toBe("green");
    const recent = injury({ date: day(-R.INJURY_RECENT_DAYS), trend: "worse" });
    expect(run(GOOD, { extras: { injuries: [recent] } }).level).toBe("amber");
  });

  it("worse trend plus a bad check-in is red; injury reasons come first", () => {
    const r = run(checkin({ feeling: 2, drinks: 3 }), { extras: { injuries: [injury({ date: TODAY, trend: "worse" })] } });
    expect(r.level).toBe("red");
    expect(r.reasons[0]).toMatch(/getting worse/);
  });
});

describe("readiness: missing check-in", () => {
  it("is green with a note when nothing else stands out", () => {
    expect(run(null)).toEqual({ level: "green", reasons: ["no check-in yet: based on load and injuries only"] });
  });

  it("still counts load, hard days and injuries", () => {
    const r = run(null, { sessions: [hard(day(-1)), hard(day(-2))] });
    expect(r.level).toBe("amber");
    expect(r.reasons).toEqual(["2 hard days in a row: make today easy or rest", "no check-in yet: based on load and injuries only"]);
  });

  it("falls back to the check-in's date (or latest session) when today isn't passed", () => {
    expect(readiness(checkin({}), load(), [hard(day(-1)), hard(day(-2))]).level).toBe("amber");
    expect(readiness(null, null, []).level).toBe("green");
  });
});
