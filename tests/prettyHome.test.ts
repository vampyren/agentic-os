import { describe, expect, it } from "vitest";
import { prettyHome } from "../src/lib/prettyHome";

describe("prettyHome", () => {
  it("collapses Linux home paths", () => {
    expect(prettyHome("/home/spawn/Documents/Obsidian")).toBe("~/Documents/Obsidian");
  });

  it("collapses macOS home paths", () => {
    expect(prettyHome("/Users/rex/Documents")).toBe("~/Documents");
  });

  it("leaves non-home paths unchanged", () => {
    expect(prettyHome("/mnt/data/file.md")).toBe("/mnt/data/file.md");
  });
});
