import { describe, it, expect } from "vitest";
import { stripAnsi, clampLines } from "../src/kernel/textSanitize";

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("\x1b[1mhello\x1b[0m")).toBe("hello");
    expect(stripAnsi("\x1b[31merror\x1b[0m: bad")).toBe("error: bad");
  });

  it("removes nested / chained sequences common in CLI table headers", () => {
    const raw = "\x1b[1m\x1b[37mPreview\x1b[0m \x1b[2mLast\x1b[0m";
    expect(stripAnsi(raw)).toBe("Preview Last");
  });

  it("strips cursor / movement codes (CSI moves)", () => {
    expect(stripAnsi("\x1b[2K\x1b[1Adone")).toBe("done");
    expect(stripAnsi("\x1b[H\x1b[Jcleared")).toBe("cleared");
  });

  it("strips OSC hyperlink sequences", () => {
    // OSC 8 hyperlink: ESC ] 8 ; ; URL ESC \ TEXT ESC ] 8 ; ; ESC \
    // Some emitters use BEL () as terminator instead.
    const link = "\x1b]8;;https://example.com\x07click\x1b]8;;\x07";
    // Either fully gone OR with the link text preserved is acceptable;
    // we accept the more conservative result: the ESC sequences gone.
    const cleaned = stripAnsi(link);
    expect(cleaned).not.toContain("\x1b");
    expect(cleaned).toContain("click");
  });

  it("leaves text without ANSI unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
    expect(stripAnsi("")).toBe("");
  });

  it("normalises CRLF and drops bare CR (progress-bar artifacts)", () => {
    expect(stripAnsi("a\r\nb")).toBe("a\nb");
    // Bare CR (e.g. ".\r.\r.\r") used for in-place updates.
    expect(stripAnsi("loading…\rdone")).toBe("loading…done");
  });

  it("is idempotent — calling twice produces the same result", () => {
    const raw = "\x1b[1mPreview\x1b[0m\r\nrow1";
    const once = stripAnsi(raw);
    const twice = stripAnsi(once);
    expect(twice).toBe(once);
  });
});

describe("clampLines", () => {
  it("leaves short lines untouched", () => {
    expect(clampLines("hello\nworld", 50)).toBe("hello\nworld");
  });

  it("truncates long lines with a marker including the dropped count", () => {
    const line = "x".repeat(120);
    const out = clampLines(line, 100);
    expect(out).toMatch(/^x{100} … \[\+20 chars\]$/);
  });

  it("clamps each line independently", () => {
    const a = "ok";
    const b = "y".repeat(80);
    const c = "fine";
    const out = clampLines([a, b, c].join("\n"), 30);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("ok");
    expect(lines[1]).toMatch(/^y{30} … \[\+50 chars\]$/);
    expect(lines[2]).toBe("fine");
  });

  it("no-ops when maxChars <= 0 or input is empty", () => {
    expect(clampLines("anything", 0)).toBe("anything");
    expect(clampLines("anything", -5)).toBe("anything");
    expect(clampLines("", 100)).toBe("");
  });

  it("preserves whitespace columns inside the kept prefix", () => {
    // Wide-format table row: clamp must not collapse the columns it keeps.
    const row = "Preview    last-active   src   id";
    const out = clampLines(row, 1000);
    expect(out).toBe(row);
  });
});
