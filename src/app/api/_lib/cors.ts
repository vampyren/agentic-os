// Localhost-only request gate. Per SECURITY.md, Phase 1A binds 127.0.0.1
// and has no auth. Two checks, both must pass:
//
//  1. Origin allowlist. A cross-origin browser `fetch` carries an `Origin`
//     header; anything not on the allowlist is rejected.
//  2. Sec-Fetch-Site. The `Origin` check alone does NOT cover a *simple*
//     cross-origin GET — a drive-by page can hit a GET endpoint via
//     `<img src=...>` / `<script src=...>` with no `Origin` at all. The
//     action endpoints (`GET /api/agents/<name>/actions/<id>`) spawn real
//     subprocesses, so that is a genuine CSRF surface. Browsers attach
//     `Sec-Fetch-Site` to every request: `same-origin` and `none` (direct
//     navigation) are trusted; `same-site` / `cross-site` are rejected.
//
// Non-browser clients (curl, local CLIs) send NEITHER header, so they still
// pass — the localhost-trust model for non-browser callers is unchanged.

const ALLOWED = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

// Sec-Fetch-Site values that indicate a browser request from a context we
// do not trust.
const HOSTILE_FETCH_SITE = new Set(["cross-site", "same-site"]);

export function originOk(req: Request): boolean {
  // (1) Origin allowlist — reject a cross-origin Origin we don't know.
  //     A missing Origin (same-origin request, or curl) falls through.
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED.has(origin)) return false;

  // (2) Sec-Fetch-Site — reject browser requests from another site even
  //     when no Origin header is present (simple cross-origin GET). A
  //     missing header (non-browser client) falls through.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && HOSTILE_FETCH_SITE.has(fetchSite.toLowerCase())) return false;

  return true;
}

export function forbidden(): Response {
  return new Response("forbidden: cross-origin request rejected", { status: 403 });
}
