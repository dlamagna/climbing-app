import { describe, expect, it } from "vitest";
import { NOT_THIS_WEEK, isWeekly, multiAnswer, togglePick } from "./coachAnswers";

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
});

describe("isWeekly", () => {
  it("matches the weekly topic only", () => {
    expect(isWeekly({ topic: "week_days:2026-05-04" })).toBe(true);
    expect(isWeekly({ topic: null })).toBe(false);
    expect(isWeekly({})).toBe(false);
  });
});
