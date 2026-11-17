// Build-time helpers for the service worker (public/sw.js): which built files it precaches on install, and
// writing that list and the deploy's version into the copied sw.js. Used by the swPrecache plugin in
// vite.config.ts; kept free of Node APIs so it can be tested directly.
export interface SwManifest {
  version: string;
  urls: string[];
}

export const MANIFEST_PLACEHOLDER = "self.__SW_MANIFEST";

// Files in the build output (paths relative to it, "/" separated) to URLs to precache. index.html is cached
// as "/" (the app's start URL; the static host redirects /index.html to it), the service worker itself and
// source maps are left out.
export function precacheUrls(files: readonly string[]): string[] {
  const urls = files
    .filter((f) => f !== "sw.js" && !f.endsWith(".map") && !f.split("/").some((part) => part.startsWith(".")))
    .map((f) => (f === "index.html" ? "/" : `/${f}`));
  return [...new Set(urls)].sort();
}

export function injectManifest(swSource: string, manifest: SwManifest): string {
  const parts = swSource.split(MANIFEST_PLACEHOLDER);
  if (parts.length !== 2) throw new Error(`sw.js must contain ${MANIFEST_PLACEHOLDER} exactly once, found ${parts.length - 1}`);
  return parts.join(JSON.stringify(manifest));
}
