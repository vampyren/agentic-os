import { describe, expect, it } from "vitest";
import { highlightTerms, parseSnippet } from "../src/lib/highlight";

describe("highlightTerms", () => {
  it("returns plain text when query is empty", () => {
    expect(highlightTerms("Some title here", "")).toEqual([
      { text: "Some title here", mark: false },
    ]);
    expect(highlightTerms("Some title here", "   ")).toEqual([
      { text: "Some title here", mark: false },
    ]);
  });

  it("returns plain text when text is empty", () => {
    expect(highlightTerms("", "claude")).toEqual([
      { text: "", mark: false },
    ]);
  });

  it("returns plain text when no match", () => {
    expect(highlightTerms("Obsidian vault notes", "hermes")).toEqual([
      { text: "Obsidian vault notes", mark: false },
    ]);
  });

  it("marks a single case-insensitive match", () => {
    expect(highlightTerms("Talking to Claude today", "claude")).toEqual([
      { text: "Talking to ", mark: false },
      { text: "Claude", mark: true },
      { text: " today", mark: false },
    ]);
  });

  it("marks multiple non-adjacent matches", () => {
    expect(highlightTerms("claude vs Claude vs CLAUDE", "claude")).toEqual([
      { text: "claude", mark: true },
      { text: " vs ", mark: false },
      { text: "Claude", mark: true },
      { text: " vs ", mark: false },
      { text: "CLAUDE", mark: true },
    ]);
  });

  it("handles a match at the start of the string", () => {
    expect(highlightTerms("Claude is the topic", "claude")).toEqual([
      { text: "Claude", mark: true },
      { text: " is the topic", mark: false },
    ]);
  });

  it("handles a match at the end of the string", () => {
    expect(highlightTerms("Today's topic is claude", "claude")).toEqual([
      { text: "Today's topic is ", mark: false },
      { text: "claude", mark: true },
    ]);
  });

  it("matches any whitespace-separated term in a multi-word query", () => {
    const segs = highlightTerms("Claude code review notes", "claude review");
    // Both 'claude' and 'review' should be marked.
    expect(segs).toEqual([
      { text: "Claude", mark: true },
      { text: " code ", mark: false },
      { text: "review", mark: true },
      { text: " notes", mark: false },
    ]);
  });

  it("treats each whitespace-separated query term as an independent matcher", () => {
    // Multi-word queries are split on whitespace. The title helper is
    // intentionally a per-token substring match (FTS5 handles real
    // phrase matching server-side and emits its own «...» markers).
    const segs = highlightTerms("Talking about claude code today", "claude code");
    expect(segs).toEqual([
      { text: "Talking about ", mark: false },
      { text: "claude", mark: true },
      { text: " ", mark: false },
      { text: "code", mark: true },
      { text: " today", mark: false },
    ]);
  });

  it("prefers the longer term when two terms share a prefix (longest-first sort)", () => {
    // Without the longest-first sort, regex alternation would match
    // 'claude' inside 'claude-code' and leave '-code' unmarked. The
    // sort guarantees 'claude-code' wins when both are valid terms.
    const segs = highlightTerms("Working on claude-code today", "claude claude-code");
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(["claude-code"]);
  });

  it("escapes regex metacharacters in the query — no regex injection", () => {
    // Query contains '(' which would otherwise unbalance the wrapping
    // group and throw or match incorrectly.
    const segs = highlightTerms("Look at (foo) brackets", "(foo)");
    expect(segs).toEqual([
      { text: "Look at ", mark: false },
      { text: "(foo)", mark: true },
      { text: " brackets", mark: false },
    ]);
  });

  it("escapes a dot in the query so it does not match any character", () => {
    // Query 'a.b' must match 'a.b' literally, NOT 'axb'.
    const segs = highlightTerms("axb and a.b in text", "a.b");
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(["a.b"]);
  });

  it("never returns empty-string segments", () => {
    // Adjacent matches would otherwise produce empty plain segments
    // between them — the helper filters those out.
    const segs = highlightTerms("aaaa", "a");
    expect(segs).toEqual([
      { text: "a", mark: true },
      { text: "a", mark: true },
      { text: "a", mark: true },
      { text: "a", mark: true },
    ]);
    expect(segs.every((s) => s.text.length > 0)).toBe(true);
  });
});

describe("parseSnippet", () => {
  it("returns plain text when input has no markers", () => {
    expect(parseSnippet("just plain text")).toEqual([
      { text: "just plain text", mark: false },
    ]);
  });

  it("returns one segment with empty string for empty input", () => {
    expect(parseSnippet("")).toEqual([{ text: "", mark: false }]);
  });

  it("marks a single «...» match in the middle", () => {
    expect(parseSnippet("before «match» after")).toEqual([
      { text: "before ", mark: false },
      { text: "match", mark: true },
      { text: " after", mark: false },
    ]);
  });

  it("marks multiple matches separated by plain text", () => {
    expect(parseSnippet("«alpha» and «beta» and «gamma»")).toEqual([
      { text: "alpha", mark: true },
      { text: " and ", mark: false },
      { text: "beta", mark: true },
      { text: " and ", mark: false },
      { text: "gamma", mark: true },
    ]);
  });

  it("handles a match at the very start", () => {
    expect(parseSnippet("«hello» world")).toEqual([
      { text: "hello", mark: true },
      { text: " world", mark: false },
    ]);
  });

  it("handles a match at the very end", () => {
    expect(parseSnippet("hello «world»")).toEqual([
      { text: "hello ", mark: false },
      { text: "world", mark: true },
    ]);
  });

  it("gracefully renders an unclosed « as plain text (fail-soft)", () => {
    // Server should never emit this, but if it did, the helper must
    // not throw — the search results UI would otherwise blank out.
    const segs = parseSnippet("hello «world without close");
    expect(segs).toEqual([
      { text: "hello ", mark: false },
      { text: "world without close", mark: false },
    ]);
  });

  it("preserves whitespace and unicode around the markers", () => {
    expect(parseSnippet("café «résumé» niño")).toEqual([
      { text: "café ", mark: false },
      { text: "résumé", mark: true },
      { text: " niño", mark: false },
    ]);
  });
});
