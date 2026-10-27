import { timingSafeEqual } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PLACEHOLDER_PREFIX, tokenMatches } from "./auth";

// crypto.subtle.timingSafeEqual is a Workers extension; give Node the same function for these tests.
beforeAll(() => {
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (!subtle.timingSafeEqual) subtle.timingSafeEqual = (a, b) => timingSafeEqual(a, b);
});

// Low-entropy on purpose, so the secret scanner in CI does not flag a test value.
const TOKEN = "a".repeat(48);

describe("tokenMatches", () => {
  it("accepts the exact token", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
  });

  it("rejects a different token, including one of another length", () => {
    expect(tokenMatches("b".repeat(48), TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.slice(1), TOKEN)).toBe(false);
  });

  it("fails closed when the secret or the request token is missing", () => {
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });

  it("rejects everything while the secret still holds the example placeholder", () => {
    const placeholder = PLACEHOLDER_PREFIX;
    expect(tokenMatches(placeholder, placeholder)).toBe(false);
  });
});
