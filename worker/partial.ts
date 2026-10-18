// Partial writes: only the columns a caller passes are written, so a correction made a day or two later
// doesn't wipe fields recorded earlier. In a values object, undefined = leave as is, null = clear.
// Column names only ever come from the callers' whitelists (FieldSpec keys), never from input.

import { BadRequest } from "./errors";

export interface Sql {
  sql: string;
  params: unknown[];
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

const provided = (columns: readonly string[], values: Record<string, unknown>) =>
  columns.filter((c) => values[c] !== undefined);

// Every column, with missing values as null: a full replace through the same builders.
export const allColumns = (columns: readonly string[], values: Record<string, unknown>) =>
  Object.fromEntries(columns.map((c) => [c, values[c] ?? null]));

// INSERT ... ON CONFLICT (key) DO UPDATE SET <only the provided columns>. touch names a timestamp column
// set to now on update.
export function upsertSql(
  table: string,
  key: Record<string, unknown>,
  columns: readonly string[],
  values: Record<string, unknown>,
  touch?: string,
): Sql {
  const keyCols = Object.keys(key);
  const cols = provided(columns, values);
  if (!cols.length) throw new Error(`Nothing to write to ${table}`);
  const insert = [...keyCols, ...cols];
  const set = [...cols.map((c) => `${c} = excluded.${c}`), ...(touch ? [`${touch} = ${NOW}`] : [])];
  return {
    sql:
      `INSERT INTO ${table} (${insert.join(", ")}) VALUES (${insert.map(() => "?").join(", ")}) ` +
      `ON CONFLICT (${keyCols.join(", ")}) DO UPDATE SET ${set.join(", ")}`,
    params: [...keyCols.map((k) => key[k]), ...cols.map((c) => values[c])],
  };
}

// UPDATE table SET <only the provided columns> WHERE id = ? RETURNING *
export function updateByIdSql(
  table: string,
  id: number,
  columns: readonly string[],
  values: Record<string, unknown>,
  touch?: string,
): Sql {
  const cols = provided(columns, values);
  if (!cols.length) throw new Error(`Nothing to write to ${table}`);
  const set = [...cols.map((c) => `${c} = ?`), ...(touch ? [`${touch} = ${NOW}`] : [])];
  return {
    sql: `UPDATE ${table} SET ${set.join(", ")} WHERE id = ? RETURNING *`,
    params: [...cols.map((c) => values[c]), id],
  };
}

// One updatable column: how to check a value from the API / MCP, its JSON schema for MCP, and how it is
// stored when that differs (e.g. a list kept as text).
export interface FieldSpec {
  check: (v: unknown) => boolean;
  message: string;
  nullable?: boolean;
  schema: Record<string, unknown>;
  toDb?: (v: unknown) => unknown;
}

// The fields of args that spec knows, checked and converted for the database. Keys listed in `other`
// (ids, dates handled by the caller) are skipped; anything else is an error, so a typo isn't silently
// ignored while the caller thinks it was saved.
export function pickPatch(
  spec: Record<string, FieldSpec>,
  args: Record<string, unknown>,
  other: readonly string[] = [],
): Record<string, unknown> {
  const unknown = Object.keys(args).filter((k) => !(k in spec) && !other.includes(k));
  if (unknown.length) throw new BadRequest(`Unknown field(s): ${unknown.join(", ")}. Allowed: ${Object.keys(spec).join(", ")}`);
  const patch: Record<string, unknown> = {};
  for (const [col, f] of Object.entries(spec)) {
    const v = args[col];
    if (v === undefined) continue;
    if (v === null ? !f.nullable : !f.check(v)) throw new BadRequest(f.message);
    patch[col] = v === null || !f.toDb ? v : f.toDb(v);
  }
  if (!Object.keys(patch).length) throw new BadRequest(`Pass at least one of: ${Object.keys(spec).join(", ")}`);
  return patch;
}

export const schemaOf = (spec: Record<string, FieldSpec>) =>
  Object.fromEntries(Object.entries(spec).map(([k, f]) => [k, f.schema]));

// Common checks.
export const isString = (v: unknown): v is string => typeof v === "string";
export const isInt = (min: number, max = Infinity) => (v: unknown) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
export const isNumber = (min: number, max = Infinity) => (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export const oneOf = (values: readonly string[]) => (v: unknown) => values.includes(v as string);
