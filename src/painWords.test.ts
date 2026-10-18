import { describe, expect, it } from "vitest";
import { healedCandidates, noteSuggestions, partOf, reviewMatches, scanNote } from "./painWords";

const kinds = (note: string) => scanNote(note).map((h) => [h.kind, h.part]);

describe("scanNote: new tweaks", () => {
  it.each([
    ["Tweaked my neck on the last problem", "tweaked", "Neck / back"],
    ["left ring finger A2 felt tweaky", "tweaky", "Finger"],
    ["Elbow sore after the pull-ups", "sore", "Elbow"],
    ["pulled something in my shoulder", "pulled", "Shoulder"],
    ["slight twinge in the wrist on slopers", "twinge", "Wrist"],
    ["knee hurts after the drop knee", "hurts", "Knee"],
    ["lower back pain on the overhang", "pain", "Neck / back"],
    ["strained my hip on a high step", "strained", "Hip"],
  ])("%s", (note, word, part) => {
    const [hit] = scanNote(note);
    expect(hit).toMatchObject({ kind: "tweak", word, part });
  });

  it("finds a tweak without a body part when the word is strong enough", () => {
    expect(scanNote("Something felt painful on the crimp")).toMatchObject([{ kind: "tweak", word: "painful", part: null }]);
  });

  it("picks up the side", () => {
    expect(scanNote("Right shoulder tweaked")[0].side).toBe("right");
    expect(scanNote("tweaked a finger")[0].side).toBeNull();
  });

  it("keeps the matched clause as the snippet", () => {
    expect(scanNote("Great session. Sent the project, but tweaked my wrist on the top-out!")[0].snippet).toBe(
      "tweaked my wrist on the top-out",
    );
  });

  it("shortens long snippets", () => {
    const s = scanNote(`tweaked my finger ${"really ".repeat(30)}badly`)[0].snippet;
    expect(s.length).toBeLessThanOrEqual(90);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("scanNote: things that are not injuries", () => {
  it.each([
    "Great session, sent the project",
    "Pulled hard on the crimps", // weak word without a body part
    "Forearms pumped and a bit sore", // no known body part
    "Popped off the last hold twice",
    "Felt better than last week on the board", // "better" with nothing injury-like
    "Came back to the wall after a week off",
    "Got my background checks done", // "back" inside another word
    "",
  ])("%s", (note) => {
    expect(scanNote(note)).toEqual([]);
  });

  it("handles a missing note", () => {
    expect(scanNote(null)).toEqual([]);
    expect(scanNote(undefined)).toEqual([]);
  });
});

describe("scanNote: healed vs new tweak", () => {
  it.each([
    ["Neck is gone, felt normal", "gone", "Neck / back"],
    ["Finger much better today", "better", "Finger"],
    ["elbow healed", "healed", "Elbow"],
    ["No pain in the wrist at all", "no pain", "Wrist"],
    ["shoulder didn't hurt on the gaston", "didn't hurt", "Shoulder"],
    ["Knee pain-free on heel hooks", "pain-free", "Knee"],
    ["Finger didn’t hurt today", "didn't hurt", "Finger"], // curly apostrophe from the iPhone keyboard
  ])("%s", (note, word, part) => {
    expect(scanNote(note)).toMatchObject([{ kind: "healed", word, part }]);
  });

  it("treats 'pain gone' without a body part as healed", () => {
    expect(scanNote("The pain is gone")).toMatchObject([{ kind: "healed", part: null }]);
  });

  it("ignores pain-free remarks that don't name a body part", () => {
    expect(scanNote("No pain, good day")).toEqual([]);
  });

  it("does not call 'not better' or 'still sore' healed", () => {
    expect(kinds("finger not better")).toEqual([]);
    expect(kinds("Elbow better but still sore")).toEqual([
      ["healed", "Elbow"],
    ]); // "still sore" has no body part of its own
    expect(kinds("elbow still sore, not gone")).toEqual([["tweak", "Elbow"]]);
  });

  it("finds a healed and a new tweak in the same note", () => {
    expect(kinds("Elbow is better. Tweaked my left ankle on the jump though")).toEqual([
      ["healed", "Elbow"],
      ["tweak", "Ankle"],
    ]);
  });

  it("reports each kind and body part once", () => {
    expect(kinds("finger sore. finger tweaky again. neck sore")).toEqual([
      ["tweak", "Finger"],
      ["tweak", "Neck / back"],
    ]);
  });
});

describe("partOf", () => {
  it.each([
    ["Finger - ring finger A2 pulley", "Finger"],
    ["Neck / back", "Neck / back"],
    ["split finger tip", "Skin"],
    ["fingertips raw", "Skin"],
    ["TFCC", "Wrist"],
    ["golfer's elbow", "Elbow"],
    ["Other", null],
  ])("%s", (text, part) => {
    expect(partOf(text)).toBe(part);
  });

  it("uses the first body part mentioned", () => {
    expect(partOf("wrist and then the elbow")).toBe("Wrist");
  });
});

const active = [
  { id: 1, body_part: "Finger - middle finger" },
  { id: 2, body_part: "Elbow" },
  { id: 3, body_part: "Finger" },
];

describe("healedCandidates", () => {
  it("matches active injuries by body part", () => {
    const [hit] = scanNote("elbow is gone");
    expect(healedCandidates(hit, active).map((i) => i.id)).toEqual([2]);
  });

  it("returns several when ambiguous, so the app asks which", () => {
    const [hit] = scanNote("finger better");
    expect(healedCandidates(hit, active).map((i) => i.id)).toEqual([1, 3]);
  });

  it("offers every active injury when no body part is named", () => {
    const [hit] = scanNote("pain gone");
    expect(healedCandidates(hit, active)).toHaveLength(3);
  });
});

describe("noteSuggestions", () => {
  it("skips tweaks of a body part that already has an active injury", () => {
    expect(noteSuggestions("finger sore again", active).tweaks).toEqual([]);
    expect(noteSuggestions("tweaked my knee", active).tweaks).toHaveLength(1);
  });

  it("drops healed mentions with nothing to heal", () => {
    expect(noteSuggestions("knee better", active).healed).toEqual([]);
    expect(noteSuggestions("elbow better", []).healed).toEqual([]);
    expect(noteSuggestions("elbow better", active).healed[0].candidates.map((i) => i.id)).toEqual([2]);
  });
});

describe("reviewMatches", () => {
  it("lists tweaks from past notes, newest first, and ignores healed mentions", () => {
    const sessions = [
      { id: 1, date: "2026-01-02", type: "boulder", notes: "tweaked my wrist" },
      { id: 2, date: "2026-01-09", type: "board", notes: "wrist better. Neck sore" },
      { id: 3, date: "2026-01-05", type: "lead", notes: "fun routes" },
    ];
    expect(reviewMatches(sessions).map((m) => [m.session.id, m.hit.part])).toEqual([
      [2, "Neck / back"],
      [1, "Wrist"],
    ]);
  });
});
