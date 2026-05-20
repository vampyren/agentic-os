import { describe, expect, it } from "vitest";
import {
  ALLOWED_MISSION_OUTPUT_ROOTS,
  isAllowedMissionOutputFolder,
  toVaultRelativePath,
} from "../src/lib/vaultPaths";

describe("isAllowedMissionOutputFolder", () => {
  it("accepts each allowed root exactly", () => {
    for (const root of ALLOWED_MISSION_OUTPUT_ROOTS) {
      expect(isAllowedMissionOutputFolder(root)).toBe(true);
    }
  });

  it("accepts a path nested under an allowed root", () => {
    expect(isAllowedMissionOutputFolder("00_Inbox/agentic-os/summaries/2026")).toBe(true);
  });

  it("rejects a path outside the allowed roots", () => {
    expect(isAllowedMissionOutputFolder("00_Inbox/agentic-os/chats")).toBe(false);
    expect(isAllowedMissionOutputFolder("01_Projects/whatever")).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(isAllowedMissionOutputFolder("/00_Inbox/agentic-os/summaries")).toBe(false);
  });

  it("rejects a path containing a .. segment", () => {
    expect(
      isAllowedMissionOutputFolder("00_Inbox/agentic-os/summaries/../../../etc"),
    ).toBe(false);
  });

  it("rejects a path with a backslash", () => {
    expect(isAllowedMissionOutputFolder("00_Inbox\\agentic-os\\summaries")).toBe(false);
  });

  it("rejects empty / non-string input", () => {
    expect(isAllowedMissionOutputFolder("")).toBe(false);
    expect(isAllowedMissionOutputFolder(undefined)).toBe(false);
    expect(isAllowedMissionOutputFolder(42)).toBe(false);
  });

  it("rejects a near-prefix that is not a path-segment boundary", () => {
    // "...summariesX" must NOT match the "...summaries" root.
    expect(isAllowedMissionOutputFolder("00_Inbox/agentic-os/summariesX")).toBe(false);
  });
});

describe("toVaultRelativePath", () => {
  it("brands a valid path and trims a trailing slash", () => {
    expect(toVaultRelativePath("00_Inbox/agentic-os/missions/")).toBe(
      "00_Inbox/agentic-os/missions",
    );
  });

  it("throws on a non-allowed path", () => {
    expect(() => toVaultRelativePath("somewhere/else")).toThrow(
      /not an allowed mission output folder/i,
    );
  });
});
