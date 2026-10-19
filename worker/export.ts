// Pure helpers for GET /api/export (full backup as JSON, or one table as CSV).
import { COLUMN_DOCS, SCHEMA_NOTES, TABLE_DOCS } from "./schema-docs";

type Row = Record<string, unknown>;

// SQLite's own tables, D1's migration bookkeeping and Cloudflare's internal tables (_cf_KV, which
// D1 refuses to read) are not user data.
const INTERNAL_TABLE = /^(sqlite_|d1_|_cf_)/;

export const isUserTable = (name: string) => !INTERNAL_TABLE.test(name);

// Table names from sqlite_master, so tables added by later migrations are exported automatically.
export const userTables = (names: string[]) => names.filter(isUserTable).sort();

// Identifiers can't be bound as parameters; only names that came from sqlite_master get here.
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function exportFilename(date: string, format: "json" | "csv" = "json", table?: string): string {
  return `climbing-export-${table ? `${table}-` : ""}${date}.${format}`;
}

export interface ExportFile {
  exported_at: string;
  schema_version: string | null;
  docs: { notes: string; tables: Record<string, string>; columns: Record<string, Record<string, string>> };
  tables: Record<string, Row[]>;
}

export function buildExport(tables: Record<string, Row[]>, schemaVersion: string | null, now: Date): ExportFile {
  return {
    exported_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    schema_version: schemaVersion,
    // Makes the file self-describing without the code.
    docs: { notes: SCHEMA_NOTES, tables: TABLE_DOCS, columns: COLUMN_DOCS },
    tables,
  };
}

// RFC 4180: quote a field containing a comma, quote, CR or LF, doubling inner quotes. NULL is empty.
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Columns come from PRAGMA table_info so an empty table still gets its header row.
export function toCsv(columns: string[], rows: Row[]): string {
  const lines = [columns, ...rows.map((r) => columns.map((c) => r[c]))].map((cells) => cells.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}
