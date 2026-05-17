// originOk gate: two-layer browser CSRF defense.
//
// Layer 1 — Origin allowlist: cross-origin browser `fetch` always sends an
// Origin header; anything not on the allowlist is rejected.
//
// Layer 2 — Sec-Fetch-Site: a simple cross-origin GET (`<img>`, `<script>`,
// `<link>`) is not stamped with an Origin, but every modern browser DOES
// stamp Sec-Fetch-Site. We reject `same-site` and `cross-site` so a hostile
// local page can't trigger our side-effecting action endpoints.
//
// Non-browser clients (curl / local CLIs / supertest etc.) send NEITHER
// header, so the gate still passes for them — the localhost-trust model for
// non-browser callers is unchanged.

import { describe, it, expect } from "vitest";
import { originOk } from "../src/app/api/_lib/cors";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/agents", { headers });
}

describe("originOk", () => {
  it("allows requests with NO Origin and NO Sec-Fetch-Site (curl / local CLI)", () => {
    expect(originOk(req())).toBe(true);
  });

  it("allows allowlisted Origin: http://127.0.0.1:3000", () => {
    expect(originOk(req({ origin: "http://127.0.0.1:3000" }))).toBe(true);
  });

  it("allows allowlisted Origin: http://localhost:3000", () => {
    expect(originOk(req({ origin: "http://localhost:3000" }))).toBe(true);
  });

  it("rejects unknown / cross-origin Origin", () => {
    expect(originOk(req({ origin: "http://evil.example" }))).toBe(false);
    expect(originOk(req({ origin: "https://localhost:3000" }))).toBe(false); // wrong scheme
    expect(originOk(req({ origin: "http://localhost:8080" }))).toBe(false); // wrong port
  });

  it("rejects browser cross-site requests even with no Origin (drive-by <img>/<script>)", () => {
    expect(originOk(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("rejects browser same-site (different subdomain) requests with no Origin", () => {
    expect(originOk(req({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("allows browser same-origin requests with no Origin", () => {
    // Browsers send Sec-Fetch-Site: same-origin on same-origin fetches even
    // when they omit the Origin header (e.g. GET with `same-origin` credentials).
    expect(originOk(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("allows direct navigation / bookmark (Sec-Fetch-Site: none)", () => {
    expect(originOk(req({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("rejects mixed-case Cross-Site (proves the lowercase normalisation)", () => {
    expect(originOk(req({ "sec-fetch-site": "Cross-Site" }))).toBe(false);
    expect(originOk(req({ "sec-fetch-site": "CROSS-SITE" }))).toBe(false);
  });

  it("rejection wins when Origin is allowlisted but Sec-Fetch-Site says cross-site", () => {
    // Defensive: if for some reason a hostile context spoofed Origin but the
    // browser still tagged Sec-Fetch-Site honestly, we still reject.
    expect(originOk(req({
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "cross-site",
    }))).toBe(false);
  });
});
