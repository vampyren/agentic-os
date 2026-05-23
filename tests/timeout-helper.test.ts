// effectiveSignal — locked design tests (M4a-5 PR AB, spec §7 / §13).
//
// effectiveSignal MUST always bound a fetch by the default timeout, regardless
// of whether the operator passed a ctx.signal. Three assertions matter:
//   (1) no ctx.signal -> the returned signal aborts after `defaultMs`.
//   (2) already-aborted ctx.signal -> the returned signal is pre-aborted.
//   (3) a long-running ctx.signal CANNOT mask the default timeout — even if
//       the operator's signal never aborts, the default still wins.

import { describe, expect, it } from "vitest";
import { effectiveSignal } from "../src/kernel/connectors/timeout";

// Helper: wait for `signal` to abort, or `cap` ms (whichever first). Returns
// the actual ms elapsed; throws if neither happens within `cap`.
async function waitForAbort(signal: AbortSignal, cap: number): Promise<number> {
  if (signal.aborted) return 0;
  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("did not abort in time")), cap);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
  return Date.now() - startedAt;
}

describe("effectiveSignal", () => {
  it("aborts within defaultMs when no ctx.signal is supplied", async () => {
    const s = effectiveSignal(undefined, 80);
    const elapsed = await waitForAbort(s, 1000);
    // Allow a generous +200 ms ceiling — CI schedulers are noisy.
    expect(elapsed).toBeLessThan(300);
    expect(s.aborted).toBe(true);
  });

  it("returns an already-aborted signal when ctx.signal is pre-aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const s = effectiveSignal(ctrl.signal, 1000);
    expect(s.aborted).toBe(true);
  });

  it("aborts within defaultMs when ctx.signal is long-running (default cannot be masked)", async () => {
    // ctx.signal will never abort during this test — only the default timeout
    // can. The mask-the-timeout regression was the v1.0 bug.
    const ctrl = new AbortController();
    const s = effectiveSignal(ctrl.signal, 80);
    const elapsed = await waitForAbort(s, 1000);
    expect(elapsed).toBeLessThan(300);
    expect(s.aborted).toBe(true);
    // ctx.signal itself stayed unaborted — the default timeout is what fired.
    expect(ctrl.signal.aborted).toBe(false);
  });

  it("aborts when ctx.signal aborts BEFORE the default timeout fires", async () => {
    const ctrl = new AbortController();
    const s = effectiveSignal(ctrl.signal, 5000);
    setTimeout(() => ctrl.abort(), 60);
    const elapsed = await waitForAbort(s, 1000);
    expect(elapsed).toBeLessThan(400);
    expect(s.aborted).toBe(true);
  });

  it("rejects non-positive defaultMs at the call site (defensive)", () => {
    expect(() => effectiveSignal(undefined, 0)).toThrow(/positive finite/);
    expect(() => effectiveSignal(undefined, -1)).toThrow(/positive finite/);
    expect(() => effectiveSignal(undefined, Number.POSITIVE_INFINITY)).toThrow(/positive finite/);
    expect(() => effectiveSignal(undefined, Number.NaN)).toThrow(/positive finite/);
  });
});
