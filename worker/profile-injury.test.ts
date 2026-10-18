import { describe, expect, it } from "vitest";
import { injuryProfileEntries, isInjuryKey, profileInjuryWarnings, splitProfileUpdate } from "./profile-injury";

describe("isInjuryKey", () => {
  it.each(["current_injury", "injury", "injuries", "pain", "finger_pain", "currentInjury", "Current Injury", "injury_rules", "rehab", "tweaks"])(
    "%s is an injury key",
    (k) => expect(isInjuryKey(k)).toBe(true),
  );
  it.each(["goal", "trip_date", "level", "weekly_availability", "gym_setup", "timezone", "painting_hobby", "spain_trip"])(
    "%s is not",
    (k) => expect(isInjuryKey(k)).toBe(false),
  );
});

describe("splitProfileUpdate", () => {
  it("drops injury keys with a value but lets them be removed", () => {
    expect(splitProfileUpdate({ goal: "made-up goal", current_injury: "sore finger", pain: null, injury: "" })).toEqual({
      allowed: { goal: "made-up goal", pain: null, injury: null },
      rejected: ["current_injury"],
    });
  });
});

describe("profileInjuryWarnings", () => {
  const profile = { goal: "made-up goal", current_injury: "Left elbow sore after board session", injuries: "  " };

  it("warns when the profile mentions an injury and nothing is tracked", () => {
    expect(injuryProfileEntries(profile)).toEqual([["current_injury", "Left elbow sore after board session"]]);
    const [w, ...rest] = profileInjuryWarnings(profile, 0);
    expect(rest).toEqual([]);
    expect(w).toMatch(/profile\.current_injury/);
    expect(w).toMatch(/report_injury/);
  });

  it("is quiet when an injury is tracked or the profile has none", () => {
    expect(profileInjuryWarnings(profile, 1)).toEqual([]);
    expect(profileInjuryWarnings({ goal: "x" }, 0)).toEqual([]);
  });
});
