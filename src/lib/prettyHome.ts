// Collapse common home-directory paths to "~" for display only.
// This is intentionally heuristic and client-safe: it does not read
// process.env, so it can be used from client components.

export function prettyHome(p: string): string {
  const m = p.match(/^(\/home\/[^/]+|\/Users\/[^/]+)(\/.*)?$/);
  if (m) return "~" + (m[2] ?? "");
  return p;
}
