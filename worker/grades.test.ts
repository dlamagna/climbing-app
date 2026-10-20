import { describe, expect, it } from "vitest";
import { LADDERS, disciplineOf, gradeHint, gradeLabels, gradeProgress, gradeTable, gradeTimeline, parseGrade, usualSystem } from "./grades";
import { SESSION_TYPES } from "./sessions";

const p = (text: string, context?: string) => parseGrade(text, context);

describe("the tables", () => {
  it("cover the expected range", () => {
    expect(LADDERS.boulder.rungs[0]).toEqual(["3", ["VB"]]);
    expect(p("V16")?.font).toBe("8C+");
    expect(p("8C+", "boulder")?.v).toBe("V16");
    expect(p("3", "lead")?.yds).toBe("5.4");
    expect(p("9b", "lead")?.yds).toBe("5.15b");
    expect(p("5.15")).not.toBeNull();
  });

  it("have unique finer labels and coarser labels in non-decreasing order", () => {
    for (const { rungs, coarser } of Object.values(LADDERS)) {
      expect(new Set(rungs.map((r) => r[0])).size).toBe(rungs.length);
      const indexOf = (label: string) => rungs.findIndex((r) => r[1].includes(label));
      const coarse = rungs.flatMap((r) => r[1]);
      // Each coarser grade appears on consecutive rungs only, and later ones parse harder.
      for (const label of new Set(coarse)) {
        const hits = rungs.flatMap((r, i) => (r[1].includes(label) ? [i] : []));
        expect(hits[hits.length - 1] - hits[0], label).toBe(hits.length - 1);
      }
      const order = [...new Set(coarse)].map(indexOf);
      expect(order, coarser).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("parse every grade in the table, in increasing index order", () => {
    for (const [d, { rungs }] of Object.entries(LADDERS)) {
      const finer = rungs.map((r) => p(r[0], d)!.index);
      expect(finer).toEqual(rungs.map((_, i) => i));
      const coarser = [...new Set(rungs.flatMap((r) => r[1]))].map((l) => p(l)!.index);
      for (let i = 1; i < coarser.length; i++) expect(coarser[i]).toBeGreaterThanOrEqual(coarser[i - 1]); // 5.11b and 5.11c share 6c+
    }
  });

  it("use the standard equivalences", () => {
    const boulder: [string, string][] = [
      ["6A", "V3"], ["6B", "V4"], ["6C", "V5"], ["7A", "V6"], ["7A+", "V7"], ["7B", "V8"], ["7B+", "V8"],
      ["7C", "V9"], ["7C+", "V10"], ["8A", "V11"],
    ];
    for (const [font, v] of boulder) expect(p(font, "boulder")?.v, font).toBe(v);
    const route: [string, string][] = [
      ["5c", "5.9"], ["6a", "5.10a"], ["6a+", "5.10b"], ["6b", "5.10c"], ["6b+", "5.10d"], ["6c", "5.11a"],
      ["6c+", "5.11b/c"], ["7a", "5.11d"], ["7a+", "5.12a"], ["7b", "5.12b"], ["7b+", "5.12c"], ["7c", "5.12d"],
      ["7c+", "5.13a"], ["8a", "5.13b"],
    ];
    for (const [french, yds] of route) expect(p(french, "lead")?.yds, french).toBe(yds);
  });
});

describe("parseGrade", () => {
  it("reads Font and V both ways", () => {
    expect(p("6C", "boulder")).toEqual({ discipline: "boulder", system: "font", index: 9, font: "6C", v: "V5" });
    expect(p("V5")).toEqual({ discipline: "boulder", system: "v", index: 9.5, font: "6C/6C+", v: "V5" });
    expect(p("V6")).toMatchObject({ font: "7A", index: 11 });
    expect(p("VB")).toMatchObject({ font: "3" });
  });

  it("reads French and YDS both ways", () => {
    expect(p("7a+", "lead")).toEqual({ discipline: "route", system: "french", index: 14, french: "7a+", yds: "5.12a" });
    expect(p("5.12a")).toEqual({ discipline: "route", system: "yds", index: 14, french: "7a+", yds: "5.12a" });
    expect(p("5.11b")).toMatchObject({ french: "6c+", index: 12 });
    expect(p("5.11c")).toMatchObject({ french: "6c+", index: 12 });
    expect(p("5.7")).toMatchObject({ french: "4c/5a", index: 3.5 });
  });

  it("ignores case and spaces", () => {
    for (const t of ["v5", " V5 ", "V 5"]) expect(p(t)?.index, t).toBe(9.5);
    for (const t of ["6c+", "6C+", " 6c + "]) expect(p(t, "boulder")?.font, t).toBe("6C+");
    expect(p("7A+", "lead")?.french).toBe("7a+");
    expect(p("5.11B")?.french).toBe("6c+");
  });

  it("tells Font from French by session type, else by case", () => {
    expect(p("6c", "boulder")).toMatchObject({ discipline: "boulder", system: "font", v: "V5" });
    expect(p("6c", "board")).toMatchObject({ discipline: "boulder" });
    expect(p("6C", "lead")).toMatchObject({ discipline: "route", system: "french", yds: "5.11a" });
    expect(p("6c", "toprope")).toMatchObject({ discipline: "route" });
    expect(p("6c", "route")).toMatchObject({ discipline: "route" });
    expect(p("6C")).toMatchObject({ discipline: "boulder", system: "font" });
    expect(p("6c")).toMatchObject({ discipline: "route", system: "french" });
    expect(p("6C", "hangboard")).toMatchObject({ discipline: "boulder" }); // no context from non-climbing types
  });

  it("lets V and YDS name their own discipline whatever the session type", () => {
    expect(p("V5", "lead")).toMatchObject({ discipline: "boulder", system: "v" });
    expect(p("5.10a", "boulder")).toMatchObject({ discipline: "route", system: "yds" });
  });

  it("needs context for number-only grades", () => {
    expect(p("5+")).toBeNull();
    expect(p("5+", "boulder")).toMatchObject({ font: "5+", v: "V2" });
    expect(p("5+", "lead")).toMatchObject({ french: "5c", yds: "5.9" });
    expect(p("5", "lead")?.french).toBe("5b");
    expect(p("5-", "lead")?.french).toBe("5a");
    expect(p("4", "boulder")?.v).toBe("V0");
  });

  it("reads YDS with and without a letter", () => {
    expect(p("5.9")).toMatchObject({ french: "5c", index: 6 });
    expect(p("5.9+")?.french).toBe("5c");
    expect(p("5.11")).toMatchObject({ french: "6c+", index: 12 }); // middle of a-d
    expect(p("5.10")).toMatchObject({ index: 8.5, french: "6a+/6b" });
    expect(p("5.10-")).toMatchObject({ index: 7.5, french: "6a/6a+" });
    expect(p("5.10+")).toMatchObject({ index: 9.5, french: "6b/6b+" });
    expect(p("5.9a")).toBeNull();
  });

  it("takes the midpoint of slash grades, including short forms", () => {
    expect(p("6b/6b+", "lead")).toMatchObject({ index: 9.5, french: "6b/6b+", yds: "5.10c/d" });
    expect(p("6b/+", "lead")?.index).toBe(9.5);
    expect(p("6A/B", "boulder")).toMatchObject({ index: 6, font: "6A+" });
    expect(p("V4/5")).toMatchObject({ system: "v", index: 8.5, v: "V4/5", font: "6B+/6C" });
    expect(p("V4 / V5")?.index).toBe(8.5);
    expect(p("5.11b/c")).toMatchObject({ french: "6c+", index: 12 });
    expect(p("5.10d/5.11a")).toMatchObject({ index: 10.5, yds: "5.10d/5.11a" });
    expect(p("4/5", "boulder")).toMatchObject({ index: 2, font: "4+" });
    expect(p("6B+/6C")).toMatchObject({ discipline: "boulder", index: 8.5 }); // case gives the context
    expect(p("6C/V5")).toMatchObject({ discipline: "boulder" }); // mixed systems, same discipline
  });

  it("rejects what it can't read", () => {
    for (const t of ["", "  ", "project", "flash", "hard", "V18", "V", "5.16a", "5.3", "10a", "6", "3a", "2"]) {
      expect(p(t, "boulder"), t).toBeNull();
      expect(p(t, "lead"), t).toBeNull();
    }
    expect(p("6C/5.11a")).toBeNull(); // boulder vs route halves
    expect(p("V5/5.10a")).toBeNull();
    expect(p("6a/6b/6c", "lead")).toBeNull();
    expect(p("V4/x")).toBeNull();
    expect(parseGrade(null, "boulder")).toBeNull();
    expect(parseGrade(42, "boulder")).toBeNull();
  });
});

describe("helpers", () => {
  it("maps every climbing session type to a discipline", () => {
    expect(SESSION_TYPES.map((t) => [t, disciplineOf(t)])).toEqual([
      ["boulder", "boulder"], ["board", "boulder"], ["lead", "route"], ["toprope", "route"], ["hangboard", null],
      ["strength", null], ["cardio", null], ["mobility", null], ["other", null],
    ]);
    expect(disciplineOf(null)).toBeNull();
  });

  it("labels any index, and nothing off the ladder", () => {
    expect(gradeLabels("boulder", 0.5)).toEqual({ font: "3/4", v: "VB/V0" });
    expect(gradeLabels("route", 12.5)).toEqual({ french: "6c+/7a", yds: "5.11b/c/d" });
    expect(gradeLabels("boulder", 99)).toEqual({});
  });

  it("writes the Log page hint", () => {
    expect(gradeHint(p("6C", "boulder")!)).toBe("Font 6C = V5");
    expect(gradeHint(p("V5")!)).toBe("V5 = Font 6C/6C+");
    expect(gradeHint(p("6c+", "lead")!)).toBe("French 6c+ = YDS 5.11b/c");
    expect(gradeHint(p("5.12a")!)).toBe("YDS 5.12a = French 7a+");
  });
});

describe("gradeProgress", () => {
  // Made-up sessions only.
  const TODAY = "2026-06-30";
  const s = (date: string, type: string, max_grade: string | null) => ({ date, type, max_grade });

  it("compares the last 28 days with the 28 before and ever, per discipline", () => {
    const progress = gradeProgress(
      [
        s("2026-06-25", "boulder", "6C"),
        s("2026-06-10", "board", "V5"), // 9.5, harder than 6C (9)
        s("2026-06-03", "boulder", "6B+"), // first day of the last 28
        s("2026-05-20", "boulder", "6B"),
        s("2026-05-05", "boulder", "6A+"),
        s("2026-04-01", "boulder", "7A"), // before both windows
        s("2026-06-20", "lead", "6b"),
        s("2026-07-02", "boulder", "8A"), // after today: ignored
        s("2026-06-21", "boulder", "project"),
        s("2026-06-22", "strength", null),
      ],
      TODAY,
    );
    expect(progress).toEqual({
      boulder: {
        last_28_days: { date: "2026-06-10", index: 9.5, font: "6C/6C+", v: "V5" },
        previous_28_days: { date: "2026-05-20", index: 7, font: "6B", v: "V4" },
        best_ever: { date: "2026-04-01", index: 11, font: "7A", v: "V6" },
        change: 2.5,
      },
      route: {
        last_28_days: { date: "2026-06-20", index: 9, french: "6b", yds: "5.10c" },
        previous_28_days: null,
        best_ever: { date: "2026-06-20", index: 9, french: "6b", yds: "5.10c" },
        change: null,
      },
    });
  });

  it("gives ties to the most recent session and leaves out disciplines with no readable grade", () => {
    const progress = gradeProgress([s("2026-06-01", "boulder", "7A"), s("2026-06-15", "boulder", "V6"), s("2026-06-16", "lead", "hard")], TODAY);
    expect(progress.boulder?.best_ever.date).toBe("2026-06-15");
    expect(progress.route).toBeUndefined();
    expect(gradeProgress([], TODAY)).toEqual({});
  });
});

describe("gradeTable", () => {
  it("has one row per rung, with a V grade spanning the rungs it covers", () => {
    const rows = gradeTable("boulder");
    expect(rows).toHaveLength(LADDERS.boulder.rungs.length);
    const v3 = rows.findIndex((r) => r.finer === "6A");
    expect(rows[v3]).toMatchObject({ coarser: "V3", span: 2 });
    expect(rows[v3 + 1]).toMatchObject({ finer: "6A+", coarser: null, span: 0 });
    expect(rows.find((r) => r.finer === "7A")).toMatchObject({ coarser: "V6", span: 1 });
  });

  it("covers every rung exactly once with the spans", () => {
    for (const d of ["boulder", "route"] as const) {
      expect(gradeTable(d).reduce((n, r) => n + r.span, 0)).toBe(LADDERS[d].rungs.length);
    }
  });

  it("writes a split YDS cell in short and merges 4c/5a under 5.7", () => {
    const rows = gradeTable("route");
    expect(rows.find((r) => r.finer === "6c+")?.coarser).toBe("5.11b/c");
    expect(rows.find((r) => r.finer === "4c")).toMatchObject({ coarser: "5.7", span: 2 });
  });
});

describe("gradeTimeline", () => {
  const sessions = [
    { date: "2026-03-01", type: "boulder", max_grade: "6B" },
    { date: "2026-03-01", type: "board", max_grade: "V5" },
    { date: "2026-03-01", type: "lead", max_grade: "6c" },
    { date: "2026-03-10", type: "boulder", max_grade: "6A+" },
    { date: "2026-04-20", type: "boulder", max_grade: "6C" },
    { date: "2026-04-21", type: "boulder", max_grade: "project" },
    { date: "2026-05-01", type: "boulder", max_grade: "7A" },
  ];

  it("keeps each day's hardest grade in its discipline, oldest first", () => {
    const { days } = gradeTimeline(sessions, "boulder", "2026-04-30");
    expect(days.map((d) => [d.date, d.grades])).toEqual([
      ["2026-03-01", ["V5"]],
      ["2026-03-10", ["6A+"]],
      ["2026-04-20", ["6C"]],
    ]);
    expect(gradeTimeline(sessions, "route", "2026-04-30").days.map((d) => d.grades)).toEqual([["6c"]]);
  });

  it("gives the hardest of the 28 days ending on each day", () => {
    const { days, best28 } = gradeTimeline(sessions, "boulder", "2026-04-30");
    expect(best28.map((p) => p.index)).toEqual([days[0].index, days[0].index, days[2].index]);
  });

  it("lists grades tied for the day's hardest once each", () => {
    const tie = [
      { date: "2026-03-01", type: "boulder", max_grade: "6C" },
      { date: "2026-03-01", type: "boulder", max_grade: "6c " },
      { date: "2026-03-01", type: "board", max_grade: "6C" },
    ];
    expect(gradeTimeline(tie, "boulder", "2026-03-01").days[0].grades).toEqual(["6C", "6c"]);
  });
});

describe("usualSystem", () => {
  it("picks the system most grades were logged in, the finer one on a tie or with none", () => {
    const s = (max_grade: string) => ({ date: "2026-03-01", type: "boulder", max_grade });
    expect(usualSystem([s("V4"), s("V5"), s("6C")], "boulder")).toBe("v");
    expect(usualSystem([s("V4"), s("6C")], "boulder")).toBe("font");
    expect(usualSystem([], "route")).toBe("french");
  });
});
