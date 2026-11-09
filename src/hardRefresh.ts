// Clears the service worker and its caches, then reloads so the newest deployment is fetched.
export interface RefreshEnv {
  serviceWorker?: { getRegistrations(): Promise<readonly { unregister(): Promise<unknown> }[]> };
  caches?: { keys(): Promise<string[]>; delete(key: string): Promise<unknown> };
  reload(): void;
}

export async function hardRefresh(env: RefreshEnv): Promise<void> {
  try {
    const regs = (await env.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // keep going: still try to clear caches and reload
  }
  try {
    const keys = (await env.caches?.keys()) ?? [];
    await Promise.all(keys.map((k) => env.caches!.delete(k)));
  } catch {
    // ignore
  }
  env.reload();
}

export function hardRefreshBrowser(): Promise<void> {
  return hardRefresh({
    serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
    caches: typeof caches !== "undefined" ? caches : undefined,
    reload: () => window.location.reload(),
  });
}
