// Applies every migration to an in-memory SQLite and checks COLUMN_DOCS against the real schema.
// Run by vitest only (excluded from worker/tsconfig.json, which has Workers types and no Node types).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { COLUMN_DOCS, TABLE_DOCS, annotateSchema } from "./schema-docs";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

// stripComments mimics D1, which drops SQL comments before applying a migration (the migrations
// contain no "--" inside string literals, so the naive regex is enough here).
function migratedDb(stripComments = false): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    db.exec(stripComments ? sql.replace(/--.*$/gm, "") : sql);
  }
  return db;
}

const INTERNAL = /^(sqlite_|d1_|_cf_)/;

function actualSchema(db: DatabaseSync): Record<string, string[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => String(r.name))
    .filter((name) => !INTERNAL.test(name));
  return Object.fromEntries(
    tables.map((t) => [t, db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => String(c.name))]),
  );
}

describe("COLUMN_DOCS", () => {
  const db = migratedDb();
  const schema = actualSchema(db);

  it("documents every column created by the migrations", () => {
    const missing = Object.entries(schema).flatMap(([t, cols]) =>
      cols.filter((c) => !COLUMN_DOCS[t]?.[c]?.trim()).map((c) => `${t}.${c}`),
    );
    expect(missing, "Add these to COLUMN_DOCS in worker/schema-docs.ts").toEqual([]);
  });

  it("has no entries for tables or columns that don't exist", () => {
    const stale = Object.entries(COLUMN_DOCS).flatMap(([t, cols]) =>
      Object.keys(cols)
        .filter((c) => !schema[t]?.includes(c))
        .map((c) => `${t}.${c}`),
    );
    const staleTables = Object.keys(TABLE_DOCS).filter((t) => !schema[t]);
    expect([...stale, ...staleTables], "Remove these from worker/schema-docs.ts").toEqual([]);
  });

  // node:sqlite keeps the migrations' comments in sqlite_master.sql, D1 doesn't (and ALTER TABLE then
  // appends columns as ", col TEXT" before the closing paren); both must come out annotated.
  it.each([
    ["with SQL comments", false],
    ["comments stripped, like D1", true],
  ])("is inlined into the get_schema output (%s)", (_name, strip) => {
    const sqls = migratedDb(strip)
      .prepare(
        // Same query as get_schema.
        "SELECT sql FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND sql IS NOT NULL AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'",
      )
      .all()
      .map((r) => String(r.sql));
    const out = annotateSchema(sqls);
    for (const [t, cols] of Object.entries(COLUMN_DOCS)) {
      for (const [c, doc] of Object.entries(cols)) {
        expect(out, `${t}.${c}`).toMatch(new RegExp(`^  ${c} .*-- ${doc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
      }
    }
    expect(out).not.toContain("energy + soreness in one"); // the migration's own comment

    // The annotated schema must still be valid SQL that builds the same tables.
    const copy = new DatabaseSync(":memory:");
    copy.exec(out);
    expect(actualSchema(copy)).toEqual(schema);
  });
});
