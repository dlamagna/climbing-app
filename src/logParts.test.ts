import { describe, expect, it } from "vitest";
import { logParts, partMinutes } from "./logParts";

describe("partMinutes", () => {
  it("splits the session length evenly over newly picked types, in 5-minute steps", () => {
    expect(partMinutes(["boulder", "lead"], {}, 90)).toEqual({ boulder: 45, lead: 45 });
    expect(partMinutes(["boulder", "board", "lead"], {}, 100)).toEqual({ boulder: 35, board: 35, lead: 35 });
  });

  it("keeps minutes already set and drops unpicked types", () => {
    expect(partMinutes(["boulder", "lead", "board"], { boulder: 50, lead: 40, toprope: 20 }, 110)).toEqual({ boulder: 50, lead: 40, board: 35 });
  });

  it("never goes below 5 minutes", () => {
    expect(partMinutes(["boulder", "lead"], {}, 5)).toEqual({ boulder: 5, lead: 5 });
  });
});

describe("logParts", () => {
  it("is null for zero or one type", () => {
    expect(logParts([], {})).toBeNull();
    expect(logParts(["boulder"], { boulder: 60 })).toBeNull();
  });

  it("lists the types in the order picked with their minutes", () => {
    expect(logParts(["lead", "boulder"], { boulder: 30, lead: 60 })).toEqual([
      { type: "lead", duration_min: 60 },
      { type: "boulder", duration_min: 30 },
    ]);
  });
});
