// Where the demo keeps its database between visits: this browser's IndexedDB (best effort: a private
// window just keeps the demo in memory). Kept apart from backend.ts so the landing page can reset the
// demo without loading SQLite.

const STORE = "climb-demo";
const KEY = "db";
const META_KEY = "climb.demo.seeded"; // date the current demo data was generated

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(STORE, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadBytes(): Promise<Uint8Array | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function saveBytes(bytes: Uint8Array | null) {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    if (bytes) tx.objectStore(STORE).put(bytes, KEY);
    else tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export const getMeta = () => {
  try {
    return localStorage.getItem(META_KEY);
  } catch {
    return null;
  }
};
export const setMeta = (v: string | null) => {
  try {
    if (v) localStorage.setItem(META_KEY, v);
    else localStorage.removeItem(META_KEY);
  } catch {
    // ignore
  }
};

// The app's offline cache and outbox would otherwise show data from before a reset.
export function clearAppCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("climb.cache:") || k === "climb.outbox") localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

// Forgets the saved demo without starting it; the app seeds fresh data the next time it opens.
export async function forgetDemo() {
  setMeta(null);
  await saveBytes(null);
  clearAppCache();
}
