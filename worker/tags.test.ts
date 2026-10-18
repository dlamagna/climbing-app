import { describe, expect, it } from "vitest";
import { FINGER_TYPES } from "./load";
import {
  FINGER_WEIGHT_MAX,
  FINGER_WEIGHT_MIN,
  SESSION_TAGS,
  TAG_FINGER_WEIGHTS,
  TYPE_FINGER_WEIGHTS,
  fingerWeight,
  parseTags,
  tagsColumn,
  tagsError,
} from "./tags";

describe("fingerWeight", () => {
  it("is the type weight when untagged", () => {
    expect(fingerWeight("boulder", null)).toBe(1);
    expect(fingerWeight("boulder", undefined)).toBe(1);
    expect(fingerWeight("boulder", "")).toBe(1);
    expect(fingerWeight("hangboard", null)).toBe(1);
    expect(fingerWeight("board", null)).toBe(1.2);
    expect(fingerWeight("lead", [])).toBe(0.7);
  });

  it("applies single tags (boulder has type weight 1)", () => {
    expect(fingerWeight("boulder", "crimpy")).toBe(1.2);
    expect(fingerWeight("boulder", "board")).toBe(1.2);
    expect(fingerWeight("boulder", "slab")).toBe(0.6);
    expect(fingerWeight("boulder", "vertical")).toBe(0.6);
    expect(fingerWeight("boulder", "technique")).toBe(0.6);
    for (const t of ["open-hand", "overhang", "projecting", "volume"]) expect(fingerWeight("boulder", t)).toBe(1);
  });

  it("has a weight for every tag and every finger type", () => {
    for (const t of SESSION_TAGS) expect(TAG_FINGER_WEIGHTS[t]).toBeGreaterThan(0);
    for (const t of FINGER_TYPES) expect(TYPE_FINGER_WEIGHTS[t]).toBeGreaterThan(0);
  });

  it("combines tags by taking the highest tag weight", () => {
    expect(fingerWeight("boulder", "slab,technique")).toBe(0.6); // all low
    expect(fingerWeight("boulder", "slab,vertical,technique")).toBe(0.6);
    expect(fingerWeight("boulder", "slab,overhang")).toBe(1); // a neutral tag lifts it back to 1
    expect(fingerWeight("boulder", "slab,crimpy")).toBe(1.2); // a high tag wins
    expect(fingerWeight("boulder", ["volume", "open-hand"])).toBe(1);
  });

  it("multiplies type and tag weights", () => {
    expect(fingerWeight("board", "crimpy")).toBe(1.44);
    expect(fingerWeight("board", "slab")).toBe(0.72);
    expect(fingerWeight("lead", "overhang")).toBe(0.7);
    expect(fingerWeight("lead", "crimpy")).toBe(0.84);
    expect(fingerWeight("lead", ["volume", "open-hand"])).toBe(0.7);
  });

  it("clamps the product to the allowed range", () => {
    expect(fingerWeight("lead", "slab")).toBe(FINGER_WEIGHT_MIN); // 0.42
    expect(fingerWeight("lead", "slab,technique")).toBe(0.5);
    const max = Math.max(...Object.values(TYPE_FINGER_WEIGHTS)) * Math.max(...Object.values(TAG_FINGER_WEIGHTS));
    expect(max).toBeLessThanOrEqual(FINGER_WEIGHT_MAX); // today nothing reaches the cap
    for (const type of FINGER_TYPES) {
      for (const tag of SESSION_TAGS) {
        const w = fingerWeight(type, tag);
        expect(w).toBeGreaterThanOrEqual(FINGER_WEIGHT_MIN);
        expect(w).toBeLessThanOrEqual(FINGER_WEIGHT_MAX);
      }
    }
  });

  it("ignores a tag naming the session's own type", () => {
    expect(fingerWeight("board", "board")).toBe(1.2); // not 1.44
    expect(fingerWeight("board", ["crimpy", "board", "projecting"])).toBe(1.44); // crimpy still counts
    expect(fingerWeight("board", "board,slab")).toBe(0.72);
  });

  it("ignores unknown tags and tags on types that can't carry them", () => {
    expect(fingerWeight("boulder", "slab,nonsense")).toBe(0.6);
    expect(fingerWeight("boulder", "nonsense")).toBe(1);
    expect(fingerWeight("hangboard", "slab")).toBe(1);
    expect(fingerWeight("strength", "crimpy")).toBe(1); // not a finger type: computeLoadStats adds 0 anyway
  });
});

describe("parseTags / tagsColumn", () => {
  it("parses the stored column into canonical order", () => {
    expect(parseTags("overhang,crimpy")).toEqual(["crimpy", "overhang"]);
    expect(parseTags(" slab , technique ")).toEqual(["slab", "technique"]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags("crimpy,bogus")).toEqual(["crimpy"]);
  });

  it("stores a deduplicated, ordered comma list, NULL when empty", () => {
    expect(tagsColumn(["volume", "crimpy", "crimpy"])).toBe("crimpy,volume");
    expect(tagsColumn(["open-hand"])).toBe("open-hand");
    expect(tagsColumn([])).toBeNull();
    expect(tagsColumn(null)).toBeNull();
    expect(tagsColumn(undefined)).toBeNull();
  });

  it("round-trips", () => {
    expect(parseTags(tagsColumn(["board", "slab"]))).toEqual(["slab", "board"]);
  });
});

describe("tagsError", () => {
  it("accepts no tags, an empty list or known tags on climbing types", () => {
    expect(tagsError(undefined, "boulder")).toBeNull();
    expect(tagsError(null, "strength")).toBeNull();
    expect(tagsError([], "cardio")).toBeNull();
    expect(tagsError(["crimpy", "overhang"], "boulder")).toBeNull();
    expect(tagsError(["board"], "board")).toBeNull();
    expect(tagsError(["slab"], "lead")).toBeNull();
  });

  it("rejects unknown tags and non-lists", () => {
    expect(tagsError(["crimpy", "dyno"], "boulder")).toMatch(/tags must be a list/);
    expect(tagsError("crimpy", "boulder")).toMatch(/tags must be a list/);
    expect(tagsError([1], "boulder")).toMatch(/tags must be a list/);
    expect(tagsError({ crimpy: true }, "boulder")).toMatch(/tags must be a list/);
  });

  it("rejects tags on non-climbing types", () => {
    expect(tagsError(["crimpy"], "hangboard")).toMatch(/only for boulder, board, lead/);
    expect(tagsError(["slab"], "strength")).toMatch(/only for/);
  });
});
