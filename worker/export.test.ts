import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildExport, csvField, exportFilename, isUserTable, quoteIdent, toCsv, userTables } from "./export";
import { COLUMN_DOCS } from "./schema-docs";

describe("userTables", () => {
  it("drops SQLite, D1 and Cloudflare internals and sorts the rest", () => {
    expect(
      userTables(["sessions", "sqlite_sequence", "d1_migrations", "_cf_KV", "_cf_METADATA", "checkins", "profile"]),
    ).toEqual(["checkins", "profile", "sessions"]);
  });

  it("keeps user tables that merely contain an internal prefix", () => {
    expect(isUserTable("my_d1_notes")).toBe(true);
    expect(isUserTable("cf_stuff")).toBe(true);
  });

  it("covers every table the migrations create", () => {
    const db = new DatabaseSync(":memory:");
    const dir = join(import.meta.dirname, "..", "migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name));
    expect(userTables(names)).toEqual(Object.keys(COLUMN_DOCS).sort());
  });
});

describe("quoteIdent", () => {
  it("double-quotes and escapes embedded quotes", () => {
    expect(quoteIdent("sessions")).toBe('"sessions"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

describe("exportFilename", () => {
  it("names the JSON backup by date", () => {
    expect(exportFilename("2026-10-18")).toBe("climbing-export-2026-10-18.json");
  });

  it("includes the table for a CSV", () => {
    expect(exportFilename("2026-10-18", "csv", "sessions")).toBe("climbing-export-sessions-2026-10-18.csv");
  });
});

describe("buildExport", () => {
  it("wraps the tables with a timestamp, schema version and docs", () => {
    const tables = { sessions: [{ id: 1, type: "boulder" }] };
    const file = buildExport(tables, "0007_session_tags.sql", new Date("2026-10-18T07:30:12.345Z"));
    expect(file.exported_at).toBe("2026-10-18T07:30:12Z");
    expect(file.schema_version).toBe("0007_session_tags.sql");
    expect(file.tables).toBe(tables);
    expect(file.docs.columns.sessions.rpe).toBeTruthy();
  });
});

describe("csv", () => {
  it("leaves plain values alone and blanks NULL", () => {
    expect(csvField("boulder")).toBe("boulder");
    expect(csvField(42)).toBe("42");
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvField("crimpy,slab")).toBe('"crimpy,slab"');
    expect(csvField('felt "strong"')).toBe('"felt ""strong"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it("writes a header from the columns, rows in column order, CRLF line ends", () => {
    const csv = toCsv(["id", "type", "tags"], [
      { tags: "crimpy,slab", id: 1, type: "boulder" },
      { id: 2, type: "lead", tags: null },
    ]);
    expect(csv).toBe('id,type,tags\r\n1,boulder,"crimpy,slab"\r\n2,lead,\r\n');
  });

  it("writes just the header for an empty table", () => {
    expect(toCsv(["id", "date"], [])).toBe("id,date\r\n");
  });
});
