// The roadmap checklist edit done after report_issue files an issue (#52).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./db";
import { INBOX_HEADING, createIssue, roadmapWithIssue } from "./github";

const ROADMAP = [
  "Planned work, grouped by milestone.",
  "",
  "### v1.1 - Polish",
  "- [x] #1",
  "- [ ] #2",
  "",
  "### v2 - Later",
  "- [ ] #7",
  "",
  "Ideas welcome: open an issue.",
  "",
  "---",
  "_footer_",
].join("\n");

describe("roadmapWithIssue", () => {
  it("adds the issue at the end of its milestone's section", () => {
    const out = roadmapWithIssue(ROADMAP, 60, "v1.1 - Polish").split("\n");
    expect(out.slice(2, 7)).toEqual(["### v1.1 - Polish", "- [x] #1", "- [ ] #2", "- [ ] #60", ""]);
  });

  it("puts issues without a known milestone in a new inbox section before the trailing text", () => {
    const out = roadmapWithIssue(ROADMAP, 61, null);
    expect(out).toContain(`- [ ] #7\n\n${INBOX_HEADING}\n- [ ] #61\n\nIdeas welcome`);
    expect(roadmapWithIssue(ROADMAP, 61, "v9 - Nope")).toBe(out);
    // and reuses it next time
    expect(roadmapWithIssue(out, 62, null)).toContain(`${INBOX_HEADING}\n- [ ] #61\n- [ ] #62\n`);
  });

  it("leaves the body alone when the issue is already listed", () => {
    expect(roadmapWithIssue(ROADMAP, 7, "v1.1 - Polish")).toBe(ROADMAP);
    expect(roadmapWithIssue(ROADMAP, 1, null)).toBe(ROADMAP);
  });

  it("doesn't mistake #70 for #7", () => {
    expect(roadmapWithIssue(ROADMAP, 70, "v2 - Later")).toContain("- [ ] #7\n- [ ] #70\n");
  });

  it("works on an empty body", () => {
    expect(roadmapWithIssue("", 5, null)).toBe(`\n\n${INBOX_HEADING}\n- [ ] #5`);
  });
});

describe("createIssue", () => {
  const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_ROADMAP_ISSUE: "14" } as unknown as Env;
  const calls: { method: string; path: string; body: any }[] = [];
  let roadmap = ROADMAP;

  function mockGithub(fail?: string) {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = url.replace("https://api.github.com/repos/o/r", "");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (fail && path.startsWith(fail)) return new Response(JSON.stringify({ message: "nope" }), { status: 403 });
      if (path.startsWith("/milestones")) return Response.json([{ number: 2, title: "v2 - Later", description: null }]);
      if (path === "/issues" && method === "POST") return Response.json({ number: 60, html_url: "https://github.com/o/r/issues/60" });
      if (path === "/issues/14" && method === "GET") return Response.json({ body: roadmap });
      if (path === "/issues/14" && method === "PATCH") return Response.json({ body: (roadmap = body.body) });
      return new Response("not mocked", { status: 500 });
    });
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    roadmap = ROADMAP;
  });

  it("files with priority label and milestone, then lists it in the roadmap", async () => {
    mockGithub();
    const r = await createIssue(env, "Louder timer", "body", { labels: ["enhancement", "not-a-label"], priority: "P2", milestone: "v2 - later" });
    expect(r).toEqual({ number: 60, url: "https://github.com/o/r/issues/60", roadmap: "added to #14" });
    const post = calls.find((c) => c.path === "/issues")!;
    expect(post.body).toMatchObject({ title: "Louder timer", labels: ["enhancement", "priority: P2"], milestone: 2 });
    expect(roadmap).toContain("- [ ] #7\n- [ ] #60\n");
  });

  it("rejects an unknown milestone before filing anything", async () => {
    mockGithub();
    await expect(createIssue(env, "t", "b", { milestone: "v9" })).rejects.toThrow(/No open milestone/);
    expect(calls.some((c) => c.path === "/issues")).toBe(false);
  });

  it("still returns the issue when the roadmap can't be edited, and can skip the roadmap", async () => {
    mockGithub("/issues/14");
    expect((await createIssue(env, "t", "b")).roadmap).toMatch(/not added to #14: GitHub 403/);
    mockGithub();
    expect(await createIssue(env, "t", "b", { addToRoadmap: false })).toEqual({ number: 60, url: "https://github.com/o/r/issues/60" });
    expect(calls.map((c) => c.path)).toEqual(["/issues"]);
  });
});
