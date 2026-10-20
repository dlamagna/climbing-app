import { describe, expect, it } from "vitest";
import { nextRunLabel, stampLabel } from "./coachRuns";
import { localDateOf } from "./dates";

// Made-up timestamps only.
const at = (stamp: string) => localDateOf(stamp);

describe("coach activity labels", () => {
  it("labels a run time with the local day and time", () => {
    const stamp = "2026-03-04T10:15:00Z";
    expect(stampLabel(stamp, at(stamp))).toMatch(/^Today \d{2}.\d{2}/);
    expect(stampLabel("garbage")).toBe("garbage");
  });

  it("says when the next run is expected, overdue, or not known yet", () => {
    const expected = "2026-03-05T10:15:00Z";
    expect(nextRunLabel(null)).toBe("After the first run");
    expect(nextRunLabel("nope")).toBe("Unknown");
    expect(nextRunLabel(expected, new Date("2026-03-05T09:00:00Z"), at(expected))).toMatch(/^Expected around Today /);
    expect(nextRunLabel(expected, new Date("2026-03-05T11:00:00Z"), at(expected))).toMatch(/^Overdue \(expected Today /);
  });
});
