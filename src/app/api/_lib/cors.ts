// Localhost-only CORS gate. Per SECURITY.md, Phase 1A binds 127.0.0.1 and
// rejects any cross-origin request whose Origin header isn't on the allowlist.
// Same-origin requests (no Origin header) pass.

const ALLOWED = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

export function originOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;             // same-origin or curl-style requests
  return ALLOWED.has(origin);
}

export function forbidden(): Response {
  return new Response("forbidden: non-localhost origin", { status: 403 });
}
