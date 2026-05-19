// Safe React-friendly text highlighting for the Memory page (Slice 6).
// Both helpers return a flat array of { text, mark } segments — pure
// data, no JSX — so the caller can map them to <mark> / plain spans
// without using dangerouslySetInnerHTML.
//
// Two sources of "match" markers:
//
//   1. The FTS5 server-side snippet generator wraps matched terms in
//      « and » (declared in src/kernel/vaultIndex.ts). Parse those.
//      Use this for the result-row snippet — FTS5 knows about token
//      boundaries, stemming, etc., so its match markers are more
//      accurate than a client-side substring search.
//
//   2. For the result-row TITLE (which has no server-side markers),
//      we substring-match the user's query terms. Case-insensitive.
//      Multi-word query: any whitespace-separated term may match.
//      Sorted longest-first so a query like "claude code" doesn't
//      tokenise "claudeBot" into "claude" + "Bot" if "claude" alone
//      would have matched the full token.
//
// All inputs are treated as opaque strings. Special regex metachars
// in the user's query are escaped so the regex compiler can't be
// tricked into broken alternations or catastrophic backtracking.
//
// FAIL-SOFT: if the input is empty / query is empty / no matches
// exist, return a single non-marked segment with the original text.
// The caller renders this as plain text — no special case needed.

export interface HighlightSegment {
  text: string;
  mark: boolean;
}

// Escape characters with special meaning in a JavaScript regex so a
// user query like "(foo)" or "a.b" is treated as literal text.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlight occurrences of the query's terms inside a plain text
 * string. Used for the result-row title. Empty/whitespace-only
 * query returns the text as one unmarked segment.
 */
export function highlightTerms(text: string, query: string): HighlightSegment[] {
  if (typeof text !== "string" || text.length === 0) {
    return [{ text: typeof text === "string" ? text : "", mark: false }];
  }
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [{ text, mark: false }];

  const terms = trimmed
    .split(/\s+/)
    .filter((t) => t.length > 0)
    // Longest first — avoids "code" matching inside "claude code" when
    // "claude code" itself is a query term (multi-word verbatim).
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return [{ text, mark: false }];

  const pattern = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  // Capturing-group split returns alternating plain/match segments.
  // Some browsers historically returned undefined for empty captures;
  // filter those and collapse adjacent empty plain segments.
  const parts = text.split(pattern);
  const out: HighlightSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i] ?? "";
    if (piece.length === 0) continue;
    // Even index = plain text, odd index = matched group.
    out.push({ text: piece, mark: i % 2 === 1 });
  }
  // Edge case: text was all one match → loop above produces just one
  // segment, which is correct. Edge case: no match → split returns
  // a single-element array (length 1), correct as well.
  if (out.length === 0) return [{ text, mark: false }];
  return out;
}

/**
 * Parse an FTS5 snippet whose matched terms are wrapped in « and »
 * (per vaultIndex.ts's snippet() call). Used for the result-row
 * snippet. Robust against malformed input — an unclosed « at the
 * end of the string is rendered as plain text rather than thrown.
 */
export function parseSnippet(snippet: string): HighlightSegment[] {
  if (typeof snippet !== "string" || snippet.length === 0) {
    return [{ text: "", mark: false }];
  }
  const out: HighlightSegment[] = [];
  let i = 0;
  while (i < snippet.length) {
    const start = snippet.indexOf("«", i);
    if (start === -1) {
      // Trailing plain text.
      if (i < snippet.length) out.push({ text: snippet.slice(i), mark: false });
      break;
    }
    if (start > i) {
      out.push({ text: snippet.slice(i, start), mark: false });
    }
    const end = snippet.indexOf("»", start + 1);
    if (end === -1) {
      // Unclosed delimiter — degrade gracefully: render the remainder
      // (minus the lone «) as plain text. We don't throw because the
      // chat surface and search UI must never break on a single
      // malformed row.
      out.push({ text: snippet.slice(start + 1), mark: false });
      break;
    }
    out.push({ text: snippet.slice(start + 1, end), mark: true });
    i = end + 1;
  }
  if (out.length === 0) return [{ text: snippet, mark: false }];
  return out;
}
