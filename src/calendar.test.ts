import { describe, expect, it } from "vitest";
import { monthEnd, monthGrid, periodRange, sessionsByDay, shiftMonth } from "./calendar";

// Made-up sample data only.
let id = 0;
const s = (date: string, type: string) => ({ id: ++id, date, type, duration_min: 60, rpe: 6 });

describe("month helpers", () => {
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-03", -15)).toBe("2024-12");
  });

  it("finds the last day of a month, including February in leap years", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(monthEnd("2026-04")).toBe("2026-04-30");
  });
});

describe("monthGrid", () => {
  it("starts weeks on Monday and pads days outside the month", () => {
    // 1 Oct 2026 is a Thursday, 31 Oct a Saturday.
    const g = monthGrid("2026-10");
    expect(g).toHaveLength(5);
    expect(g[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(g[4]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", null]);
    expect(g.flat().filter(Boolean)).toHaveLength(31);
  });

  it("handles a month starting on Monday and one needing six rows", () => {
    expect(monthGrid("2026-06")[0][0]).toBe("2026-06-01"); // a Monday
    expect(monthGrid("2026-08")).toHaveLength(6); // starts Saturday, 31 days
    expect(monthGrid("2027-02")).toHaveLength(4); // starts Monday, 28 days
  });
});

describe("sessionsByDay", () => {
  it("keeps only the month's sessions, split at month boundaries", () => {
    const rows = [s("2026-09-30", "lead"), s("2026-10-01", "boulder"), s("2026-10-31", "lead"), s("2026-11-01", "cardio")];
    expect(Object.keys(sessionsByDay(rows, "2026-10")).sort()).toEqual(["2026-10-01", "2026-10-31"]);
    expect(Object.keys(sessionsByDay(rows, "2026-09"))).toEqual(["2026-09-30"]);
    expect(Object.keys(sessionsByDay(rows, "2026-11"))).toEqual(["2026-11-01"]);
  });

  it("orders a day's sessions by group, then by id", () => {
    const rows = [s("2026-10-05", "cardio"), s("2026-10-05", "hangboard"), s("2026-10-05", "board"), s("2026-10-05", "lead"), s("2026-10-05", "boulder")];
    expect(sessionsByDay(rows, "2026-10")["2026-10-05"].map((r) => r.type)).toEqual(["lead", "board", "boulder", "hangboard", "cardio"]);
  });
});

describe("periodRange", () => {
  const TODAY = "2026-10-18";
  it("covers the last 4 or 8 weeks ending today", () => {
    expect(periodRange("4w", TODAY, "2026-10")).toEqual({ from: "2026-09-21", to: TODAY });
    expect(periodRange("8w", TODAY, "2026-10")).toEqual({ from: "2026-08-24", to: TODAY });
  });

  it("covers the whole month on screen", () => {
    expect(periodRange("month", TODAY, "2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("month", TODAY, "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
