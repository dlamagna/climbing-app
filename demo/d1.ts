// A D1Database look-alike over sql.js (SQLite compiled to WebAssembly), so the real worker code runs
// unchanged in the browser. Covers what worker/ uses: prepare/bind with all/first/run, and batch.

import type { Database, SqlValue } from "sql.js";

type Row = Record<string, unknown>;

interface Result<T = Row> {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number; duration: number };
}

// D1 accepts booleans and undefined; SQLite via sql.js only takes numbers, strings, null and bytes.
function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string" || v instanceof Uint8Array) return v;
  return String(v);
}

export class DemoStatement {
  constructor(
    private readonly db: DemoD1,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new DemoStatement(this.db, this.sql, values.map(toSql));
  }

  // Runs synchronously; the async wrappers below give it D1's promise shape.
  exec<T = Row>(): Result<T> {
    const raw = this.db.raw;
    const stmt = raw.prepare(this.sql);
    const results: T[] = [];
    try {
      stmt.bind(this.params);
      while (stmt.step()) results.push(stmt.getAsObject() as T);
    } finally {
      stmt.free();
    }
    const changes = raw.getRowsModified();
    const last = raw.exec("SELECT last_insert_rowid()")[0]?.values[0][0];
    if (!/^\s*(select|with|pragma)\b/i.test(this.sql)) this.db.dirty();
    return { results, success: true, meta: { changes, last_row_id: Number(last ?? 0), duration: 0 } };
  }

  async all<T = Row>() {
    return this.db.wrap(() => this.exec<T>());
  }

  async run<T = Row>() {
    return this.db.wrap(() => this.exec<T>());
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    return this.db.wrap(() => {
      const row = this.exec<Row>().results[0];
      if (!row) return null;
      return (column === undefined ? row : row[column]) as T;
    });
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return this.db.wrap(() => this.exec<Row>().results.map((r) => Object.values(r) as T));
  }
}

export class DemoD1 {
  constructor(
    readonly raw: Database,
    private readonly onWrite: () => void,
  ) {
    raw.run("PRAGMA foreign_keys = ON"); // D1 enforces them too
  }

  dirty() {
    this.onWrite();
  }

  // D1 reports errors with a "D1_ERROR:" prefix; keep the message the worker might show.
  async wrap<T>(f: () => T): Promise<T> {
    try {
      return f();
    } catch (e) {
      throw new Error(`D1_ERROR: ${(e as Error).message}`);
    }
  }

  prepare(sql: string) {
    return new DemoStatement(this, sql);
  }

  // All or nothing, like D1.
  async batch<T = Row>(stmts: DemoStatement[]): Promise<Result<T>[]> {
    return this.wrap(() => {
      this.raw.run("SAVEPOINT batch");
      try {
        const out = stmts.map((s) => s.exec<T>());
        this.raw.run("RELEASE batch");
        return out;
      } catch (e) {
        this.raw.run("ROLLBACK TO batch");
        this.raw.run("RELEASE batch");
        throw e;
      }
    });
  }

  async exec(sql: string) {
    return this.wrap(() => {
      this.raw.exec(sql);
      this.dirty();
      return { count: 1, duration: 0 };
    });
  }
}
