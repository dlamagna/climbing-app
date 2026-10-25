// The demo's "server": the real worker (worker/index.ts, REST API + MCP) running in the browser on an
// in-memory SQLite database, saved to this browser's IndexedDB. No network calls, no Cloudflare.

import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import { localToday, addDays } from "../src/dates";
import { DemoD1 } from "./d1";
import { seed } from "./seed";
import { getMeta, loadBytes, saveBytes, setMeta } from "./store";

export const DEMO_TOKEN = "demo";
const STALE_DAYS = 21; // older demo data is regenerated, so "the last six weeks" stays recent

// Every migration, in order, exactly as wrangler applies them to D1.
const MIGRATIONS = Object.entries(import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>)
  .map(([path, sql]) => [path.split("/").pop()!, sql] as const)
  .sort(([a], [b]) => a.localeCompare(b));

// The worker app (Hono). Loaded through a glob so the demo's type check doesn't pull in the worker, which is
// checked against the Workers types by worker/tsconfig.json.
interface WorkerApp {
  fetch(req: Request, env: unknown): Response | Promise<Response>;
}
const loadWorker = import.meta.glob<{ default: WorkerApp }>("../worker/index.ts");

// Cloudflare-only API the worker uses to compare tokens.
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
if (!subtle.timingSafeEqual) {
  subtle.timingSafeEqual = (a, b) => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    let diff = x.length ^ y.length;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
    return diff === 0;
  };
}

// Applies the migrations this database hasn't had yet (a demo saved before a new migration landed).
function migrate(raw: Database) {
  raw.run("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  const done = new Set((raw.exec("SELECT name FROM d1_migrations")[0]?.values ?? []).map((r) => r[0]));
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    raw.exec(sql);
    raw.run("INSERT INTO d1_migrations (name) VALUES (?)", [name]);
  }
}

export interface DemoBackend {
  fetch(req: Request): Promise<Response>;
  mcp(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  reset(): Promise<void>;
  flush(): Promise<void>; // saves now instead of after the debounce (before leaving the page)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export async function startBackend(): Promise<DemoBackend> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const { default: app } = await loadWorker["../worker/index.ts"]();

  let d1: DemoD1;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveBytes(d1.raw.export()), 300);
  };

  async function fresh() {
    d1 = new DemoD1(new SQL.Database(), persist);
    migrate(d1.raw);
    await seed(d1);
    setMeta(localToday());
    await saveBytes(d1.raw.export());
  }

  const seeded = getMeta();
  const bytes = seeded && seeded >= addDays(localToday(), -STALE_DAYS) ? await loadBytes() : null;
  if (bytes) {
    d1 = new DemoD1(new SQL.Database(bytes), persist);
    migrate(d1.raw);
  } else {
    await fresh();
  }

  const env = () => ({ DB: d1, APP_TOKEN: DEMO_TOKEN, MCP_TOKEN: DEMO_TOKEN });
  let rpcId = 0;

  return {
    fetch: async (req) => app.fetch(req, env()),
    async mcp(tool, args = {}) {
      const res = await app.fetch(
        new Request(`${location.origin}/mcp`, {
          method: "POST",
          headers: { Authorization: `Bearer ${DEMO_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
        }),
        env(),
      );
      const reply = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
      if (reply.error) throw new Error(reply.error.message);
      const text = reply.result!.content.map((c) => c.text).join("\n");
      if (reply.result!.isError) throw new Error(text);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    async flush() {
      clearTimeout(saveTimer);
      await saveBytes(d1.raw.export());
    },
    async reset() {
      clearTimeout(saveTimer);
      await fresh();
    },
  };
}

// Sends the app's /api calls to the in-browser worker instead of the network.
export function interceptFetch(backend: DemoBackend) {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (url.origin !== location.origin || !/^\/(api|mcp)(\/|$)/.test(url.pathname)) return real(input, init);
    return backend.fetch(new Request(url, input instanceof Request ? input : init));
  };
}
