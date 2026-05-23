// readBoundedJson — bounded HTTP body read tests (M4a-5 PR AB, spec §8 / §13).
//
// Verifies the four observable outcomes:
//   (1) under-cap JSON -> { ok: true, value }.
//   (2) exactly-at-cap is OK.
//   (3) over-cap -> { ok: false, reason: "too-large" }, NO partial value.
//   (4) malformed JSON -> { ok: false, reason: "invalid-json" }.
// + a smoke for input validation.

import { describe, expect, it } from "vitest";
import { readBoundedJson } from "../src/kernel/connectors/bodyCap";

function jsonResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("readBoundedJson", () => {
  it("returns the parsed value for an under-cap JSON body", async () => {
    const payload = { hello: "world", n: 42 };
    const res = jsonResponse(JSON.stringify(payload));
    const out = await readBoundedJson<typeof payload>(res, 1024);
    expect(out).toEqual({ ok: true, value: payload });
  });

  it("accepts a body whose byte length is exactly at the cap", async () => {
    // Build a JSON string of a known byte length, then pass maxBytes = that.
    const text = JSON.stringify({ s: "a".repeat(100) });
    const bytes = new TextEncoder().encode(text).byteLength;
    const out = await readBoundedJson(jsonResponse(text), bytes);
    expect(out.ok).toBe(true);
  });

  it("returns too-large when the body byte length exceeds the cap", async () => {
    const text = JSON.stringify({ s: "a".repeat(10_000) });
    const out = await readBoundedJson(jsonResponse(text), 256);
    expect(out).toEqual({ ok: false, reason: "too-large" });
  });

  it("does NOT leak a partial value on the over-cap path", async () => {
    const text = JSON.stringify({ secret: "do not surface", n: 1 });
    const out = await readBoundedJson(jsonResponse(text), 8);
    expect(out.ok).toBe(false);
    // Result is a discriminated union — no `value` exists on the failure
    // branch. Cast-and-poke to verify NO partial value crept in (TypeScript
    // would catch the static error, but a runtime check belt-and-braces).
    expect(("value" in (out as Record<string, unknown>))).toBe(false);
  });

  it("returns invalid-json when the body is not valid JSON", async () => {
    const out = await readBoundedJson(new Response("not json at all", { status: 200 }), 1024);
    expect(out).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("returns invalid-json when the body is empty (caller asked for JSON)", async () => {
    const out = await readBoundedJson(new Response("", { status: 200 }), 1024);
    expect(out).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("rejects non-positive maxBytes at the call site (defensive)", async () => {
    await expect(readBoundedJson(jsonResponse("{}"), 0)).rejects.toThrow(/positive finite/);
    await expect(readBoundedJson(jsonResponse("{}"), -1)).rejects.toThrow(/positive finite/);
  });
});
