import { describe, expect, it } from "vitest";
import { SESSION_TYPES as WORKER_TYPES } from "./sessions";
import { SESSION_TYPES as APP_TYPES } from "../src/types";
import { FINGER_TYPES } from "./load";
import { TAG_TYPES, TYPE_FINGER_WEIGHTS } from "./tags";
import { TYPE_GROUPS as PLAN_SIMILAR } from "./plan";
import {
  CLIMBING_TYPES,
  GROUP_KEYS,
  TYPE_GROUPS,
  climbingShares,
  climbingSummary,
  emptyMix,
  formatMinutes,
  groupMix,
  groupOf,
  mixByWeek,
  mixWindows,
} from "./typeGroups";

// Made-up sample data only.
const s = (type: string, duration_min: number, rpe: number, date = "2026-05-20") => ({ date, type, duration_min, rpe });

describe("type groups", () => {
  it("maps every session type to exactly one group", () => {
    for (const types of [WORKER_TYPES, APP_TYPES.map((t) => t.value)]) {
      for (const t of types) {
        expect(TYPE_GROUPS.filter((g) => (g.types as readonly string[]).includes(t)), t).toHaveLength(1);
      }
    }
  });

  it("only lists real session types", () => {
    for (const g of TYPE_GROUPS) for (const t of g.types) expect(WORKER_TYPES).toContain(t);
  });

  it("groups as specified", () => {
    expect(groupOf("lead")).toBe("rope");
    expect(groupOf("toprope")).toBe("rope");
    expect(groupOf("boulder")).toBe("boulder");
    expect(groupOf("board")).toBe("boulder");
    expect(groupOf("hangboard")).toBe("fingers");
    for (const t of ["strength", "cardio", "mobility", "other"]) expect(groupOf(t)).toBe("other");
  });

  it("puts unknown types in other", () => {
    expect(groupOf("yoga")).toBe("other");
    expect(groupOf(null)).toBe("other");
  });
});

describe("type lists stay consistent (#33)", () => {
  it("the app and the worker list the same session types, with lead and top rope separate", () => {
    expect(APP_TYPES.map((t) => t.value)).toEqual(WORKER_TYPES);
    expect(APP_TYPES.find((t) => t.value === "lead")?.label).toBe("Lead");
    expect(APP_TYPES.find((t) => t.value === "toprope")?.label).toBe("Top rope");
  });

  it("climbing types = rope + boulder groups = tag-capable types, all finger-loading", () => {
    expect([...CLIMBING_TYPES].sort()).toEqual(["board", "boulder", "lead", "toprope"]);
    expect([...TAG_TYPES].sort()).toEqual([...CLIMBING_TYPES].sort());
    for (const t of CLIMBING_TYPES) expect(FINGER_TYPES).toContain(t);
  });

  it("weights top rope fingers at 0.6 and every finger type has a weight", () => {
    expect(TYPE_FINGER_WEIGHTS.toprope).toBe(0.6);
    for (const t of FINGER_TYPES) expect(TYPE_FINGER_WEIGHTS[t], t).toBeTypeOf("number");
  });

  it("plan matching treats top rope as similar to the other climbing types", () => {
    expect(PLAN_SIMILAR.find((g) => g.includes("lead"))).toContain("toprope");
  });
});

describe("groupMix", () => {
  it("counts outdoor minutes per group, as part of the group's minutes", () => {
    const mix = groupMix([
      { ...s("toprope", 120, 5), outdoor: 1 },
      { ...s("lead", 250, 6), outdoor: true },
      s("lead", 60, 6),
      { ...s("boulder", 90, 7), outdoor: 0 },
      { ...s("board", 45, 8), outdoor: null },
    ]);
    expect(mix.rope).toMatchObject({ minutes: 430, outdoor_minutes: 370, sessions: 3 });
    expect(mix.boulder).toMatchObject({ minutes: 135, outdoor_minutes: 0 });
    expect(mixWindows([{ ...s("toprope", 100, 4, "2026-05-18"), outdoor: 1 }], "2026-05-20").last7.rope.outdoor_minutes).toBe(100);
  });

  it("sums minutes, load and sessions per group", () => {
    const mix = groupMix([s("lead", 60, 6), s("lead", 30, 5), s("boulder", 90, 7), s("board", 45, 8), s("hangboard", 20, 7), s("cardio", 40, 4)]);
    expect(mix.rope).toEqual({ minutes: 90, load: 510, sessions: 2, outdoor_minutes: 0 });
    expect(mix.boulder).toEqual({ minutes: 135, load: 990, sessions: 2, outdoor_minutes: 0 });
    expect(mix.fingers).toEqual({ minutes: 20, load: 140, sessions: 1, outdoor_minutes: 0 });
    expect(mix.other).toEqual({ minutes: 40, load: 160, sessions: 1, outdoor_minutes: 0 });
  });

  it("returns zeros for every group with no sessions", () => {
    expect(groupMix([])).toEqual(emptyMix());
    expect(Object.keys(groupMix([]))).toEqual(GROUP_KEYS);
  });
});

describe("climbingShares", () => {
  it("splits climbing time between rope and boulder, ignoring fingers and other", () => {
    // 6h 10m rope vs 11h 30m boulder, as in the issue's example.
    const mix = groupMix([s("lead", 370, 5), s("boulder", 690, 6), s("hangboard", 300, 7), s("strength", 500, 6)]);
    expect(climbingShares(mix)).toEqual({ rope: 35, boulder: 65 });
  });

  it("always sums to 100", () => {
    const mix = groupMix([s("lead", 1, 5), s("boulder", 1, 5), s("board", 1, 5)]);
    const { rope, boulder } = climbingShares(mix);
    expect(rope! + boulder!).toBe(100);
  });

  it("is null, not NaN, with no climbing time", () => {
    expect(climbingShares(groupMix([]))).toEqual({ rope: null, boulder: null });
    expect(climbingShares(groupMix([s("hangboard", 30, 7), s("cardio", 40, 4)]))).toEqual({ rope: null, boulder: null });
  });

  it("handles only one climbing group", () => {
    expect(climbingShares(groupMix([s("board", 60, 8)]))).toEqual({ rope: 0, boulder: 100 });
  });
});

describe("mixWindows", () => {
  const TODAY = "2026-05-20";
  it("covers the last 7 and 28 days, both ending today", () => {
    const rows = [
      s("lead", 60, 5, "2026-05-20"), // today
      s("boulder", 30, 5, "2026-05-14"), // day 7
      s("boulder", 40, 5, "2026-05-13"), // day 8: 28 only
      s("lead", 50, 5, "2026-04-23"), // day 28
      s("lead", 99, 5, "2026-04-22"), // day 29: neither
      s("lead", 77, 5, "2026-05-21"), // tomorrow: neither
    ];
    const { last7, last28 } = mixWindows(rows, TODAY);
    expect(last7.rope.minutes).toBe(60);
    expect(last7.boulder.minutes).toBe(30);
    expect(last28.rope.minutes).toBe(110);
    expect(last28.boulder.minutes).toBe(70);
  });
});

describe("mixByWeek", () => {
  it("buckets sessions into the week starting on each date", () => {
    const weeks = mixByWeek(
      [s("lead", 60, 5, "2026-05-11"), s("lead", 30, 5, "2026-05-17"), s("boulder", 45, 6, "2026-05-18"), s("boulder", 10, 6, "2026-05-10")],
      ["2026-05-11", "2026-05-18"],
    );
    expect(weeks[0].rope.minutes).toBe(90);
    expect(weeks[0].boulder.minutes).toBe(0);
    expect(weeks[1].boulder).toEqual({ minutes: 45, load: 270, sessions: 1, outdoor_minutes: 0 });
  });
});

describe("formatMinutes", () => {
  it("formats minutes as hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(370)).toBe("6h 10m");
  });
});

describe("climbingSummary (#33)", () => {
  it("adds each climbing group's outdoor time when there is some", () => {
    const mix = groupMix([
      { ...s("toprope", 120, 5), outdoor: 1 },
      s("lead", 250, 6),
      s("boulder", 690, 6),
    ]);
    expect(climbingSummary(mix)).toBe("Rope 6h 10m (35%, 2h outdoor) · Boulder 11h 30m (65%)");
  });

  it("is the plain share line when everything was indoors, null with no climbing", () => {
    expect(climbingSummary(groupMix([s("lead", 60, 5), s("board", 60, 5)]))).toBe("Rope 1h (50%) · Boulder 1h (50%)");
    expect(climbingSummary(groupMix([s("cardio", 60, 5)]))).toBeNull();
  });
});
