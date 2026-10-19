import { describe, expect, it } from "vitest";
import { checklistMessage, dayLabel, injuryName, morningChecklist, saveNotes, trainingChecklist } from "./checklists";
import { type ChecklistLoader, PROMPTS, checklistText, handlePromptRequest } from "./mcp-prompts";
import { SESSION_TAGS } from "./tags";

// Made-up sample data.
const injuries = [
  { id: 7, body_part: "Finger - ring finger A2 pulley", side: "left" },
  { id: 9, body_part: "Shoulder", side: null },
];
const limit = {
  id: 41,
  title: "Limit bouldering",
  type: "boulder",
  intensity: "hard",
  duration_min: 90,
  status: "planned",
  expected_benchmarks: [
    { name: "Max hang 20mm 10s", unit: "kg added" },
    { name: "Max pull-ups", unit: "reps" },
  ],
};
const mobility = { id: 42, title: "Hip mobility", type: "mobility", intensity: "easy", duration_min: null, status: "planned", expected_benchmarks: [] };
const rest = { id: 43, title: "Rest", type: "rest", intensity: "rest", status: "planned" };

describe("dayLabel / injuryName", () => {
  it("formats dates and names", () => {
    expect(dayLabel("2026-10-18")).toBe("Sun 18 Oct");
    expect(dayLabel("2027-01-01")).toBe("Fri 1 Jan");
    expect(injuryName(injuries[0])).toBe("Finger - ring finger A2 pulley (left)");
    expect(injuryName(injuries[1])).toBe("Shoulder");
  });
});

describe("morningChecklist", () => {
  it("is fixed text with no injury lines when nothing is active", () => {
    expect(morningChecklist("2026-10-18", [])).toBe(
      [
        "Morning log - Sun 18 Oct",
        "- Sleep: hours, and bad / ok / good",
        "- How you feel: 1 wrecked .. 5 fresh",
        "- Drinks yesterday",
        "- Protein yesterday: low / ok / high",
        "- Optional: weight, anything else",
      ].join("\n"),
    );
  });

  it("names each active injury with the follow-up questions", () => {
    const text = morningChecklist("2026-10-18", injuries);
    expect(text).toContain(
      "- Finger - ring finger A2 pulley (left): pain 0-10; better / same / worse / gone; morning stiffness?; any red flags (swelling, numbness/tingling, night pain)?",
    );
    expect(text).toContain("- Shoulder: pain 0-10;");
    // Injury lines sit between protein and the optional line.
    const lines = text.split("\n");
    expect(lines[4]).toMatch(/^- Protein/);
    expect(lines[5]).toMatch(/^- Finger/);
    expect(lines[7]).toMatch(/^- Optional/);
  });
});

describe("trainingChecklist", () => {
  const base = { date: "2026-10-18", today: "2026-10-18", injuries: [], plan: [], tags: SESSION_TAGS };

  it("is fixed text when nothing is planned and nothing is injured", () => {
    expect(trainingChecklist(base)).toBe(
      [
        "Training log - Sun 18 Oct (today)",
        "- Date, if not Sun 18 Oct",
        "- Type: boulder, board, lead, toprope, hangboard, strength, cardio, mobility, other",
        "- Duration (minutes), effort 1-10",
        "- Hardest send",
        "- What you worked on, how your fingers felt",
        "- Optional: style tags (crimpy, open-hand, slab, vertical, overhang, board, technique, projecting, volume)",
        "- Optional: indoor or outdoor? (boulder, board, lead, toprope only; indoor if not said)",
        "- Optional: which gym?",
        "- Nothing planned for Sun 18 Oct. Was this a planned session from another day?",
        "- Optional: any test / benchmark results",
        "- Optional: new tweak or injury",
      ].join("\n"),
    );
  });

  it("lists the style tags from the constant", () => {
    expect(trainingChecklist(base)).toContain(`style tags (${SESSION_TAGS.join(", ")})`);
  });

  it("names the planned entries and their expected benchmarks for the date", () => {
    const text = trainingChecklist({ ...base, plan: [limit, mobility] });
    expect(text).toContain(
      '- Was this the planned session? Planned for Sun 18 Oct: "Limit bouldering" (boulder, hard, 90 min) or "Hip mobility" (mobility, easy)',
    );
    expect(text).toContain("- Optional: results for the planned tests: Max hang 20mm 10s (kg added), Max pull-ups (reps)");
    expect(text).not.toContain("any test / benchmark results");
  });

  it("says when the date is a rest day", () => {
    expect(trainingChecklist({ ...base, plan: [rest] })).toContain(
      "- Planned for Sun 18 Oct: rest day. Was this a planned session from another day?",
    );
  });

  it("handles a session logged late and names active injuries", () => {
    const text = trainingChecklist({ ...base, date: "2026-10-16", injuries, plan: [limit] });
    expect(text.split("\n")[0]).toBe("Training log - Fri 16 Oct");
    expect(text).toContain("- Date, if not Fri 16 Oct");
    expect(text).toContain("Planned for Fri 16 Oct:");
    expect(text).toContain("- What you worked on, how your fingers and Finger - ring finger A2 pulley (left), Shoulder felt");
  });
});

describe("saveNotes / checklistMessage", () => {
  it("gives Claude the ids, outside the checklist", () => {
    expect(saveNotes("training", "2026-10-18", injuries, [limit])).toBe(
      [
        "Date: 2026-10-18.",
        "Active injuries (injury_id = name): 7 = Finger - ring finger A2 pulley (left); 9 = Shoulder.",
        'Plan entries on 2026-10-18 (plan_id = title, status): 41 = "Limit bouldering", planned.',
      ].join("\n"),
    );
    expect(saveNotes("morning", "2026-10-18", [], [limit])).toBe("Date: 2026-10-18.\nNo active injuries.");
    const msg = checklistMessage("morning", "CHECKLIST", "NOTES");
    expect(msg).toContain("---\nCHECKLIST\n---");
    expect(msg.indexOf("CHECKLIST")).toBeLessThan(msg.indexOf("For saving (don't show this part):\nNOTES"));
    expect(msg).toContain("Required: sleep hours and quality");
  });
});

describe("prompts", () => {
  const calls: (string | undefined)[] = [];
  const load: ChecklistLoader = async (date) => {
    calls.push(date);
    return { date: date ?? "2026-10-18", today: "2026-10-18", injuries, plan: date === "2026-10-17" ? [] : [limit] };
  };

  it("lists the prompts per the spec shape", async () => {
    const r = await handlePromptRequest("prompts/list", {}, load);
    expect(r).toEqual({
      prompts: [
        { name: "morning_log", title: expect.any(String), description: expect.any(String), arguments: [] },
        {
          name: "training_log",
          title: expect.any(String),
          description: expect.any(String),
          arguments: [{ name: "date", description: expect.any(String), required: false }],
        },
        { name: "daily_review", title: expect.any(String), description: expect.any(String), arguments: [] },
      ],
    });
  });

  it("gets daily_review without loading a checklist", async () => {
    calls.length = 0;
    const r: any = await handlePromptRequest("prompts/get", { name: "daily_review" }, load);
    expect(calls).toEqual([]);
    expect(r.messages[0].content.text).toContain("start_daily_review");
  });

  it("gets a prompt as one user message carrying the checklist", async () => {
    const r: any = await handlePromptRequest("prompts/get", { name: "morning_log" }, load);
    expect(r.description).toBe(PROMPTS[0].description);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[0].content.type).toBe("text");
    expect(r.messages[0].content.text).toContain(morningChecklist("2026-10-18", injuries));
    expect(r.messages[0].content.text).toBe(await checklistText("morning", undefined, load));
  });

  it("passes training_log's date argument, today by default", async () => {
    calls.length = 0;
    const today: any = await handlePromptRequest("prompts/get", { name: "training_log" }, load);
    const late: any = await handlePromptRequest("prompts/get", { name: "training_log", arguments: { date: "2026-10-17" } }, load);
    expect(calls).toEqual([undefined, "2026-10-17"]);
    expect(today.messages[0].content.text).toContain('Planned for Sun 18 Oct: "Limit bouldering"');
    expect(late.messages[0].content.text).toContain("Nothing planned for Sat 17 Oct");
  });

  it("rejects unknown prompts, bad dates and bad kinds", async () => {
    await expect(handlePromptRequest("prompts/get", { name: "nope" }, load)).rejects.toThrow("Unknown prompt: nope");
    await expect(
      handlePromptRequest("prompts/get", { name: "training_log", arguments: { date: "yesterday" } }, load),
    ).rejects.toThrow("date must be YYYY-MM-DD");
    await expect(checklistText("evening" as any, undefined, load)).rejects.toThrow("kind must be one of morning, training");
  });
});
