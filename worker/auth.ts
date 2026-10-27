// Bearer-token checks for the REST API (APP_TOKEN) and the MCP server (MCP_TOKEN).

const encoder = new TextEncoder();

// The values in .dev.vars.example start with this. A copy deployed with the example values left in place
// (easy to do from the Deploy to Cloudflare form) must not be usable by anyone who has read the example.
export const PLACEHOLDER_PREFIX = "replace-me";

// Fails closed: an unset secret, or one still holding the example placeholder, rejects everything.
export function tokenMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  if (expected.startsWith(PLACEHOLDER_PREFIX)) return false;
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
