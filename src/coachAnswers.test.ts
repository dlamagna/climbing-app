import { describe, expect, it } from "vitest";
import { NOT_THIS_WEEK, NO_CLIMBING, climbingDaysBody, isWeekly, multiAnswer, plannerDays, togglePick } from "./coachAnswers";

const options = ["Mon 4", "Tue 5", "Wed 6", NOT_THIS_WEEK];

describe("multiAnswer", () => {
  it("lists picked chips in option order, then the note", () => {
    expect(multiAnswer(["Wed 6", "Mon 4"], options, "")).toBe("Mon 4, Wed 6");
    expect(multiAnswer(["Tue 5"], options, " evenings only ")).toBe("Tue 5 - evenings only");
    expect(multiAnswer([], options, "not sure yet")).toBe("not sure yet");
    expect(multiAnswer([], options, "  ")).toBe("");
  });
});

describe("togglePick", () => {
  it("toggles days, and 'Not this week' excludes them", () => {
    expect(togglePick([], "Mon 4")).toEqual(["Mon 4"]);
    expect(togglePick(["Mon 4"], "Mon 4")).toEqual([]);
    expect(togglePick(["Mon 4", "Tue 5"], NOT_THIS_WEEK)).toEqual([NOT_THIS_WEEK]);
    expect(togglePick([NOT_THIS_WEEK], "Tue 5")).toEqual(["Tue 5"]);
  });
  it("takes another 'none' option", () => {
    expect(togglePick(["2026-05-05"], NO_CLIMBING, NO_CLIMBING)).toEqual([NO_CLIMBING]);
    expect(togglePick([NO_CLIMBING], "2026-05-05", NO_CLIMBING)).toEqual(["2026-05-05"]);
  });
});

describe("Plan my climbing days", () => {
  it("offers a week from today", () => {
    expect(plannerDays("2026-05-29")).toEqual(["2026-05-29", "2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]);
  });
  it("builds the body, nothing until something is picked", () => {
    expect(climbingDaysBody([], "")).toBeNull();
    expect(climbingDaysBody([], "a note")).toBeNull();
    expect(climbingDaysBody(["2026-05-07", "2026-05-05"], " evenings ")).toEqual({ days: ["2026-05-05", "2026-05-07"], note: "evenings" });
    expect(climbingDaysBody([NO_CLIMBING], "")).toEqual({ days: [], note: null });
  });
});

describe("isWeekly", () => {
  it("matches the weekly topic only", () => {
    expect(isWeekly({ topic: "week_days:2026-05-04" })).toBe(true);
    expect(isWeekly({ topic: null })).toBe(false);
    expect(isWeekly({})).toBe(false);
  });
});
