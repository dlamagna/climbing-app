import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { injectManifest, precacheUrls } from "./swPrecache";

describe("precacheUrls", () => {
  it("lists the built shell, with index.html as / and without the worker or source maps", () => {
    const files = ["sw.js", "index.html", "assets/index-abc.js", "assets/index-abc.js.map", "assets/index-def.css", "icon.svg", ".DS_Store"];
    expect(precacheUrls(files)).toEqual(["/", "/assets/index-abc.js", "/assets/index-def.css", "/icon.svg"]);
  });
});

describe("injectManifest", () => {
  it("replaces the placeholder in public/sw.js", () => {
    const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    const out = injectManifest(source, { version: "abc123", urls: ["/", "/assets/a.js"] });
    expect(out).toContain('const MANIFEST = {"version":"abc123","urls":["/","/assets/a.js"]}');
    expect(out).not.toContain("__SW_MANIFEST");
  });

  it("fails the build when the placeholder is missing", () => {
    expect(() => injectManifest("const x = 1;", { version: "v", urls: [] })).toThrow(/exactly once/);
  });
});
