// readBoundedJson — streamed HTTP response body read, capped by byte budget
// (M4a-5 PR AB, spec §8).
//
// HTTP connector fetches read a JSON body of bounded size. This module:
//   * reads `res.body` in chunks rather than `await res.json()` so a hostile
//     provider cannot wedge the runtime by streaming gigabytes;
//   * stops as soon as `maxBytes` is exceeded — the caller gets a neutral
//     `{ ok: false, reason: "too-large" }`;
//   * returns `{ ok: false, reason: "invalid-json" }` on parse failure;
//   * leaves NO partial value in the success/over-cap paths — a failed read
//     never yields a partially-decoded object.
//
// IMPORTANT: these byte caps are HTTP RESPONSE byte budgets, NOT model
// context-window sizes. A 2 MB cap on the JSON body is roughly hundreds of
// thousands of tokens of structured text; if a real provider response ever
// legitimately exceeds it, raise the constant, not the model context.
//
// Server-only.

export type BoundedReadResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; reason: "too-large" | "invalid-json" };

/** Named defaults — easy to bump per operation. */
export const CHAT_GENERATE_MAX_BYTES = 2 * 1024 * 1024;     // 2 MB
export const TEST_CONNECTION_MAX_BYTES = 256 * 1024;        // 256 KB
export const LIST_MODELS_MAX_BYTES = 2 * 1024 * 1024;       // 2 MB

/**
 * Read the response body as JSON, refusing once `maxBytes` is exceeded.
 *
 * - Streams the body via the WHATWG ReadableStream reader.
 * - Adds each chunk's `byteLength` to a running total; the first chunk that
 *   pushes the total past the cap is dropped and the reader is cancelled.
 * - Decodes the bytes through `TextDecoder("utf-8", { fatal: true })` so an
 *   invalid UTF-8 body fails neutrally as `invalid-json`.
 * - `JSON.parse` errors return the same `invalid-json` reason.
 */
export async function readBoundedJson<T = unknown>(
  res: Response,
  maxBytes: number,
): Promise<BoundedReadResult<T>> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new TypeError("readBoundedJson: maxBytes must be a positive finite number");
  }
  // No body at all -> treat as invalid-json (the caller asked for JSON).
  if (!res.body) {
    return { ok: false, reason: "invalid-json" };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Drop any buffered chunks and stop reading immediately. The
        // partially-decoded body never reaches the caller.
        try { await reader.cancel(); } catch { /* ignore */ }
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    // A network error mid-body. Surface as invalid-json (caller maps to a
    // neutral connector errorCode — `external-system-unavailable`).
    try { await reader.cancel(); } catch { /* ignore */ }
    return { ok: false, reason: "invalid-json" };
  }

  let text: string;
  try {
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
