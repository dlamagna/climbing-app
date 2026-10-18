import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "climb.token";
const OUTBOX_KEY = "climb.outbox";
const CACHE_PREFIX = "climb.cache:";

// Storage can throw (private mode, blocked site data); the app must still work without it.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const getToken = () => load<string | null>(TOKEN_KEY, null);
export const setToken = (token: string | null) => save(TOKEN_KEY, token);

export class AuthError extends Error {}

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function throwIfFailed(res: Response) {
  if (res.status === 401) {
    window.dispatchEvent(new Event("climb:auth"));
    throw new AuthError("Wrong or missing app token");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new HttpError(err?.error ?? `Request failed (${res.status})`, res.status);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token = getToken(), key?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token ?? ""}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfFailed(res);
  return res.json() as Promise<T>;
}

// Fetches a file the server sends as an attachment (the data export), with its filename.
export async function fetchFile(path: string): Promise<File> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  await throwIfFailed(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "climbing-export.json";
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

export const checkToken = (token: string) => request("GET", "/profile", undefined, token);

// Reads fall back to the last good response when offline (fetch throws TypeError on network failure).
export async function get<T>(path: string): Promise<T> {
  try {
    const data = await request<T>("GET", path);
    save(CACHE_PREFIX + path, data);
    return data;
  } catch (e) {
    const cached = load<T | null>(CACHE_PREFIX + path, null);
    if (e instanceof TypeError && cached !== null) return cached;
    throw e;
  }
}

interface Pending {
  method: string;
  path: string;
  body?: unknown;
  key?: string; // missing on writes queued before idempotency keys existed
}

// Writes made without signal (gym basements) are queued and replayed on the next chance.
// The same idempotency key goes with every attempt, so if the first one reached the server but its
// response was lost, the replay doesn't insert a second copy. Pass a key to refer to the row later
// (the timer addresses its auto-logged session by it).
export async function send<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  key: string = crypto.randomUUID(),
): Promise<T | { queued: true }> {
  try {
    return await request<T>(method, path, body, undefined, key);
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    save(OUTBOX_KEY, [...load<Pending[]>(OUTBOX_KEY, []), { method, path, body, key }]);
    return { queued: true };
  }
}

export const isQueued = (r: unknown): r is { queued: true } =>
  typeof r === "object" && r !== null && "queued" in r;

export const pendingCount = () => load<Pending[]>(OUTBOX_KEY, []).length;

let flushing = false;
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const queue = load<Pending[]>(OUTBOX_KEY, []);
    while (queue.length) {
      const { method, path, body, key } = queue[0];
      try {
        await request(method, path, body, undefined, key);
      } catch (e) {
        if (e instanceof TypeError || e instanceof AuthError) break; // still offline / logged out: retry later
        // Server rejected it; drop it rather than blocking everything behind it.
        console.warn("Dropping queued write", path, e);
      }
      queue.shift();
      save(OUTBOX_KEY, queue);
      sent++;
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof TypeError ? "Offline and nothing saved yet" : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastMessage {
  message: string;
  action?: ToastAction;
  ms?: number; // how long it stays up (default: 2.5 s, 6 s with an action)
}

export function toast(message: string, action?: ToastAction, ms?: number) {
  window.dispatchEvent(new CustomEvent<ToastMessage>("climb:toast", { detail: { message, action, ms } }));
}

// Shows the right toast for a write that may have been queued.
export function savedToast(result: unknown, what = "Saved") {
  toast(isQueued(result) ? `${what} offline - will sync later` : what);
}
