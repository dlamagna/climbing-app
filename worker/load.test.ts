import { describe, expect, it } from "vitest";
import { type LoadRow, addDays, computeLoadStats, daysBetween, loadWindow, mondayOf } from "./load";

// Made-up sample data only. TODAY is a Wednesday.
const TODAY = "2026-05-20";
const ago = (n: number) => addDays(TODAY, -n);
const s = (daysAgo: number, type: string, load: number): LoadRow => ({ date: ago(daysAgo), type, load });
// First session `days` days of history ago (inclusive of today), or null for no history.
const firstFor = (days: number) => (days > 0 ? ago(days - 1) : null);

describe("addDays / mondayOf", () => {
  it("adds and subtracts days", () => {
    expect(addDays("2026-05-20", 0)).toBe("2026-05-20");
    expect(addDays("2026-05-20", 3)).toBe("2026-05-23");
    expect(addDays("2026-05-20", -3)).toBe("2026-05-17");
  });

  it("rolls over months, including February and leap years", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
  });

  it("rolls over years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-12-20", 20)).toBe("2027-01-09");
  });

  it("finds the Monday of the week (weeks run Monday to Sunday)", () => {
    expect(mondayOf("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(mondayOf("2026-10-17")).toBe("2026-10-12"); // Saturday
    expect(mondayOf("2026-10-18")).toBe("2026-10-12"); // Sunday belongs to the week before
    expect(mondayOf("2026-05-20")).toBe("2026-05-18"); // Wednesday
  });

  it("finds the Monday across month and year boundaries", () => {
    expect(mondayOf("2026-03-01")).toBe("2026-02-23"); // Sunday 1 March
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // Friday 1 January
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-05-20", "2026-05-20")).toBe(0);
    expect(daysBetween("2026-12-25", "2027-01-04")).toBe(10);
    expect(daysBetween("2026-05-20", "2026-05-18")).toBe(-2);
  });
});

describe("computeLoadStats cold start", () => {
  it("0 days of history: building, no ratio", () => {
    const r = computeLoadStats([], TODAY, null, 4);
    expect(r.history_days).toBe(0);
    expect(r.baseline_status).toBe("building");
    expect(r.ratio_total).toBeNull();
    expect(r.ratio_finger).toBeNull();
    expect(r.ratio_provisional).toBe(false);
    expect(r.last7).toEqual({ total: 0, finger: 0, finger_raw: 0 });
    expect(r.prev28_weekly_avg).toEqual({ total: 0, finger: 0, finger_raw: 0 });
  });

  it("10 days of history: building, no ratio even with sessions before the last 7 days", () => {
    const rows = [s(9, "boulder", 300), s(8, "strength", 120), s(3, "board", 200), s(1, "boulder", 400)];
    const r = computeLoadStats(rows, TODAY, firstFor(10), 4);
    expect(r.history_days).toBe(10);
    expect(r.baseline_status).toBe("building");
    expect(r.ratio_total).toBeNull();
    expect(r.ratio_finger).toBeNull();
    expect(r.ratio_provisional).toBe(false);
    expect(r.last7).toEqual({ total: 600, finger: 640, finger_raw: 600 }); // board 200 x1.2 + boulder 400
  });

  it("20 days of history: partial, chronic average scaled over the 13 days that exist", () => {
    const rows = [
      s(19, "board", 200), // first session; chronic window
      s(12, "strength", 60),
      s(8, "boulder", 130),
      s(2, "boulder", 300), // acute window
      s(1, "cardio", 120),
    ];
    const r = computeLoadStats(rows, TODAY, firstFor(20), 4);
    expect(r.history_days).toBe(20);
    expect(r.baseline_status).toBe("partial");
    expect(r.ratio_provisional).toBe(true);
    // Chronic days = 20 - 7 = 13. Total 390 / 13 * 7 = 210; finger raw 330 / 13 * 7 = 177.7 -> 178;
    // weighted (board x1.2) 370 / 13 * 7 = 199.2 -> 199.
    expect(r.prev28_weekly_avg).toEqual({ total: 210, finger: 199, finger_raw: 178 });
    expect(r.last7).toEqual({ total: 420, finger: 300, finger_raw: 300 });
    expect(r.ratio_total).toBe(2); // 420 / 210 (dividing by 4 weeks would have said 4.29)
    expect(r.ratio_finger).toBe(1.51); // 300 / 199
  });

  it("35 days of history: ok, plain previous-28-day weekly average", () => {
    const rows = [
      s(34, "boulder", 100),
      s(30, "strength", 60),
      s(27, "boulder", 100),
      s(20, "boulder", 100),
      s(13, "boulder", 100),
      s(3, "boulder", 150),
    ];
    const r = computeLoadStats(rows, TODAY, firstFor(35), 4);
    expect(r.history_days).toBe(35);
    expect(r.baseline_status).toBe("ok");
    expect(r.ratio_provisional).toBe(false);
    expect(r.prev28_weekly_avg).toEqual({ total: 115, finger: 100, finger_raw: 100 }); // 460 / 4, 400 / 4
    expect(r.last7).toEqual({ total: 150, finger: 150, finger_raw: 150 });
    expect(r.ratio_total).toBe(1.3); // 150 / 115 = 1.304
    expect(r.ratio_finger).toBe(1.5);
  });

  it("ignores sessions older than the 35-day window once history is long", () => {
    const rows = [s(40, "boulder", 9999), s(20, "boulder", 280), s(2, "boulder", 70)];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    expect(r.history_days).toBe(61);
    expect(r.prev28_weekly_avg.total).toBe(70);
    expect(r.ratio_total).toBe(1);
  });

  it("switches status at 14 and 28 days", () => {
    const status = (days: number) => computeLoadStats([], TODAY, firstFor(days), 4).baseline_status;
    expect(status(13)).toBe("building");
    expect(status(14)).toBe("partial");
    expect(status(27)).toBe("partial");
    expect(status(28)).toBe("ok");
  });

  it("scales by the chronic days that exist until the full 28 are there", () => {
    // 28 days of history: 21 chronic days, 210 load -> 70 a week, not 210 / 4 = 53.
    const r = computeLoadStats([s(27, "board", 210), s(0, "board", 70)], TODAY, firstFor(28), 4);
    expect(r.prev28_weekly_avg.total).toBe(70);
    expect(r.ratio_total).toBe(1);
  });

  it("gives a null ratio, not a crash, when the previous weeks are empty", () => {
    const r = computeLoadStats([s(40, "boulder", 100), s(1, "boulder", 100)], TODAY, ago(40), 4);
    expect(r.baseline_status).toBe("ok");
    expect(r.ratio_total).toBeNull();
  });

  it("treats a first session after `today` as no history", () => {
    const r = computeLoadStats([], TODAY, addDays(TODAY, 3), 4);
    expect(r.history_days).toBe(0);
    expect(r.baseline_status).toBe("building");
  });
});

describe("computeLoadStats finger vs total load", () => {
  it("counts boulder, board, lead and hangboard as finger load only, weighted by type", () => {
    const rows = [
      s(1, "boulder", 10),
      s(1, "board", 20),
      s(2, "lead", 40),
      s(3, "hangboard", 80),
      s(4, "strength", 100),
      s(4, "cardio", 200),
      s(5, "mobility", 400),
      s(6, "other", 800),
    ];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    // boulder 10 x1 + board 20 x1.2 + lead 40 x0.7 + hangboard 80 x1 = 10 + 24 + 28 + 80
    expect(r.last7).toEqual({ total: 1650, finger: 142, finger_raw: 150 });
  });

  it("computes the finger ratio independently of the total", () => {
    const rows = [s(20, "strength", 400), s(20, "hangboard", 100), s(2, "strength", 100), s(2, "hangboard", 50)];
    const r = computeLoadStats(rows, TODAY, ago(40), 4);
    expect(r.prev28_weekly_avg).toEqual({ total: 125, finger: 25, finger_raw: 25 });
    expect(r.ratio_total).toBe(1.2); // 150 / 125
    expect(r.ratio_finger).toBe(2); // 50 / 25
  });
});

describe("computeLoadStats weekly buckets", () => {
  it("returns Monday-to-Sunday weeks ending with the current week", () => {
    const rows = [s(0, "boulder", 50), s(2, "board", 30), s(3, "strength", 20), s(16, "lead", 70)];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    expect(r.weeks.map((w) => w.week_start)).toEqual(["2026-04-27", "2026-05-04", "2026-05-11", "2026-05-18"]);
    // Today (Wed 20th) and Mon 18th are this week; Sun 17th belongs to the week of the 11th.
    expect(r.weeks[3]).toEqual({ week_start: "2026-05-18", total: 80, finger: 86, finger_raw: 80, sessions: 2 }); // board x1.2
    expect(r.weeks[2]).toEqual({ week_start: "2026-05-11", total: 20, finger: 0, finger_raw: 0, sessions: 1 });
    expect(r.weeks[1]).toEqual({ week_start: "2026-05-04", total: 70, finger: 49, finger_raw: 70, sessions: 1 }); // lead x0.7
    expect(r.weeks[0].sessions).toBe(0);
  });

  it("buckets weeks across a year boundary", () => {
    const today = "2027-01-06"; // Wednesday
    const rows: LoadRow[] = [
      { date: "2026-12-31", type: "boulder", load: 100 },
      { date: "2027-01-03", type: "cardio", load: 40 }, // Sunday, same week as 31 Dec
      { date: "2027-01-04", type: "board", load: 60 },
    ];
    const r = computeLoadStats(rows, today, "2026-11-01", 2);
    expect(r.weeks).toEqual([
      { week_start: "2026-12-28", total: 140, finger: 100, finger_raw: 100, sessions: 2 },
      { week_start: "2027-01-04", total: 60, finger: 72, finger_raw: 60, sessions: 1 }, // board x1.2
    ]);
  });

  it("queries far enough back for both the weeks and the chronic window", () => {
    expect(loadWindow(TODAY, 4)).toEqual({ from: ago(34), to: TODAY });
    expect(loadWindow(TODAY, 8)).toEqual({ from: "2026-03-30", to: TODAY });
  });
});

describe("computeLoadStats weighted finger load", () => {
  const t = (daysAgo: number, type: string, load: number, tags: string | null): LoadRow => ({ ...s(daysAgo, type, load), tags });

  it("weights finger sessions by type x tags and keeps the raw sum", () => {
    const rows = [
      t(1, "boulder", 100, null), // x1
      t(2, "boulder", 100, "slab,technique"), // x0.6
      t(3, "board", 100, "crimpy"), // x1.2 x1.2 = 1.44
      t(4, "lead", 100, "slab,overhang"), // x0.7 x1
      t(5, "hangboard", 100, null), // x1, hangboard can't carry tags
      t(6, "lead", 100, "slab"), // x0.7 x0.6 = 0.42, clamped to 0.5
    ];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    expect(r.last7).toEqual({ total: 600, finger: 524, finger_raw: 600 });
  });

  it("leaves total and non-finger types unaffected by tags", () => {
    const rows = [t(1, "strength", 200, "crimpy"), t(2, "cardio", 100, "slab"), t(3, "boulder", 100, "slab")];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    expect(r.last7).toEqual({ total: 400, finger: 60, finger_raw: 100 });
  });

  it("uses the weighted value for ratio_finger", () => {
    // Previous 28 days: 4 untagged boulder sessions of 100 -> 100 a week, raw and weighted.
    // Last 7 days: 150 of slab -> 90 weighted, 150 raw.
    const rows = [
      t(27, "boulder", 100, null),
      t(20, "boulder", 100, null),
      t(13, "boulder", 100, null),
      t(8, "boulder", 100, null),
      t(2, "boulder", 150, "slab"),
    ];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    expect(r.prev28_weekly_avg).toEqual({ total: 100, finger: 100, finger_raw: 100 });
    expect(r.last7).toEqual({ total: 150, finger: 90, finger_raw: 150 });
    expect(r.ratio_finger).toBe(0.9); // weighted; raw would have said 1.5
    expect(r.ratio_total).toBe(1.5);
  });

  it("weights the chronic average and the weekly buckets too, rounding once", () => {
    const rows = [
      t(30, "board", 35, "crimpy"), // x1.44 = 50.4
      t(20, "board", 35, "crimpy"), // 50.4
      t(10, "boulder", 25, "vertical"), // 15
      t(2, "boulder", 13, "slab"), // 7.8 -> 8
    ];
    const r = computeLoadStats(rows, TODAY, ago(60), 4);
    expect(r.prev28_weekly_avg).toEqual({ total: 24, finger: 29, finger_raw: 24 }); // 95 / 4, 115.8 / 4
    expect(r.last7).toEqual({ total: 13, finger: 8, finger_raw: 13 });
    const week = r.weeks.find((w) => w.week_start === mondayOf(ago(10)))!;
    expect(week).toEqual({ week_start: mondayOf(ago(10)), total: 25, finger: 15, finger_raw: 25, sessions: 1 });
  });
});
