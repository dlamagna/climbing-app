// Seeded timer presets (#59): the migrations add the standard protocols once, after existing presets, and
// never duplicate or overwrite a preset with the same name. Made-up data only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const SEED = "0013_more_presets.sql";

function migrate(db: DatabaseSync, upTo: string) {
  for (const f of files.filter((f) => f <= upTo)) db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
}

const presets = (db: DatabaseSync) =>
  db.prepare("SELECT name, on_s, off_s, reps, sets, set_rest_s, sort FROM timer_presets ORDER BY sort, id").all() as Record<string, unknown>[];

describe("preset seed", () => {
  it("adds the protocols after the original four, in order", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, SEED);
    expect(presets(db).map((p) => p.name)).toEqual([
      "Warm-up", "Max hangs", "Repeaters", "Abrahangs", "7/53", "MinEdge hangs", "Intermittent hangs", "Density hangs",
    ]);
    expect(presets(db).find((p) => p.name === "7/53")).toMatchObject({ on_s: 7, off_s: 53, reps: 3, sets: 3, set_rest_s: 180 });
  });

  it("keeps a preset the climber already has with the same name, and sorts after custom ones", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, files[files.indexOf(SEED) - 1]);
    db.exec("INSERT INTO timer_presets (name, prep_s, on_s, off_s, reps, sets, set_rest_s, sort) VALUES ('density HANGS', 5, 20, 60, 3, 1, 0, 9)");
    db.exec(readFileSync(join(MIGRATIONS, SEED), "utf8"));
    const rows = presets(db);
    expect(rows.filter((p) => String(p.name).toLowerCase() === "density hangs")).toEqual([
      { name: "density HANGS", on_s: 20, off_s: 60, reps: 3, sets: 1, set_rest_s: 0, sort: 9 },
    ]);
    expect(rows.slice(-3).map((p) => [p.name, p.sort])).toEqual([["7/53", 10], ["MinEdge hangs", 11], ["Intermittent hangs", 12]]);
  });
});
