import { describe, expect, it } from "vitest";
import { activeTabFor, tabsFor } from "./tabs";

const names = (inMore: boolean) => tabsFor(inMore).map((t) => t.route);

describe("tabsFor", () => {
  it("keeps Coach in the bar by default, before History", () => {
    expect(names(false)).toEqual(["today", "log", "timer", "coach", "history", "more"]);
  });

  it("drops the Coach tab when it lives under More", () => {
    expect(names(true)).toEqual(["today", "log", "timer", "history", "more"]);
  });

  it("does not mutate the shared base list", () => {
    names(false);
    expect(names(true)).toHaveLength(5);
  });
});

describe("activeTabFor", () => {
  const more = ["more", "plan"];
  it("highlights Coach or More depending on where Coach lives", () => {
    expect(activeTabFor("coach", false, more)).toBe("coach");
    expect(activeTabFor("coach", true, more)).toBe("more");
  });

  it("maps sub-pages and check-in edits", () => {
    expect(activeTabFor("plan", false, more)).toBe("more");
    expect(activeTabFor("checkin", false, more)).toBe("history");
    expect(activeTabFor("log", true, more)).toBe("log");
  });
});
