import { describe, expect, it } from "vitest";
import { canonicalGym, filterGyms, gymCounts, gymKey, gymsText, isGymInput, normalizeGym } from "./gyms";

// Made-up gym names.
const gyms = [
  { name: "Rock Hall North", sessions: 4, last_used: "2026-03-10" },
  { name: "Boulder Barn", sessions: 7, last_used: "2026-03-08" },
  { name: "The Crimp Shed", sessions: 1, last_used: "2026-02-01" },
  { name: "Café Bloc", sessions: 2, last_used: "2026-01-15" },
];
const names = (xs: { name: string }[]) => xs.map((g) => g.name);

describe("normalizeGym", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeGym("  Rock   Hall  North ")).toBe("Rock Hall North");
  });
  it("treats empty, blank and non-text as no gym", () => {
    expect(normalizeGym("")).toBeNull();
    expect(normalizeGym("   ")).toBeNull();
    expect(normalizeGym(null)).toBeNull();
    expect(normalizeGym(42)).toBeNull();
  });
});

describe("isGymInput", () => {
  it("accepts text up to 60 characters and null", () => {
    expect(isGymInput("Boulder Barn")).toBe(true);
    expect(isGymInput(null)).toBe(true);
    expect(isGymInput("x".repeat(60))).toBe(true);
  });
  it("rejects longer text and other types", () => {
    expect(isGymInput("x".repeat(61))).toBe(false);
    expect(isGymInput(3)).toBe(false);
    expect(isGymInput(["Boulder Barn"])).toBe(false);
  });
});

describe("gymKey / canonicalGym", () => {
  it("ignores case, accents and spacing", () => {
    expect(gymKey("  café   BLOC ")).toBe(gymKey("Cafe Bloc"));
  });
  it("reuses the stored spelling of a known gym", () => {
    expect(canonicalGym("boulder  barn", names(gyms))).toBe("Boulder Barn");
    expect(canonicalGym("cafe bloc", names(gyms))).toBe("Café Bloc");
  });
  it("keeps a new name, normalized", () => {
    expect(canonicalGym("  New   Wall ", names(gyms))).toBe("New Wall");
  });
  it("returns null for an empty name", () => {
    expect(canonicalGym("  ", names(gyms))).toBeNull();
    expect(canonicalGym(undefined, names(gyms))).toBeNull();
  });
});

describe("filterGyms", () => {
  it("returns every gym, in the given order, for an empty query", () => {
    expect(names(filterGyms("", gyms))).toEqual(names(gyms));
    expect(names(filterGyms("  ", gyms))).toEqual(names(gyms));
  });
  it("puts names starting with the letters first", () => {
    expect(names(filterGyms("b", gyms))).toEqual(["Boulder Barn", "Café Bloc"]); // starts with, then a word starts with
    expect(names(filterGyms("ro", gyms))).toEqual(["Rock Hall North"]);
  });
  it("then names where a later word starts with them, then names containing them", () => {
    expect(names(filterGyms("cr", gyms))).toEqual(["The Crimp Shed"]);
    expect(names(filterGyms("or", gyms))).toEqual(["Rock Hall North"]); // contained in "north"
    expect(names(filterGyms("h", gyms))).toEqual(["Rock Hall North", "The Crimp Shed"]);
  });
  it("ignores case and accents", () => {
    expect(names(filterGyms("CAFE", gyms))).toEqual(["Café Bloc"]);
  });
  it("returns nothing when no name matches", () => {
    expect(filterGyms("zzz", gyms)).toEqual([]);
  });
});

describe("gymCounts / gymsText", () => {
  it("counts sessions per gym, most first, skipping sessions without one", () => {
    const counts = gymCounts([{ gym: "Boulder Barn" }, { gym: "Rock Hall North" }, { gym: null }, { gym: "Boulder Barn" }, {}]);
    expect(counts).toEqual([
      { name: "Boulder Barn", sessions: 2 },
      { name: "Rock Hall North", sessions: 1 },
    ]);
    expect(gymsText(counts)).toBe("Boulder Barn ×2 · Rock Hall North");
  });
  it("is empty / null with no gyms", () => {
    expect(gymCounts([{ gym: null }])).toEqual([]);
    expect(gymsText([])).toBeNull();
  });
});
