// Per-route page identity registry (Track 2 Slice 2). The TopBar reads
// `usePathname()` and resolves a `{ title, sub }` here so each page's
// identity lives in one place instead of being duplicated in route H2s.
//
// Add new static routes by extending STATIC. Dynamic routes (`/agents/[name]`)
// are handled by `resolveTitle()`'s pattern matcher.

export interface PageIdentity {
  title: string;
  sub: string;
}

const STATIC: Record<string, PageIdentity> = {
  "/": {
    title: "Mission Control",
    sub: "Status of every agent, every memory, every signal.",
  },
  "/agents": {
    title: "All agents",
    sub: "Every manifest the registry has loaded.",
  },
  "/goals": {
    title: "Goals",
    sub: "Set targets. Tick them off. Saved to your Obsidian vault.",
  },
  "/journal": {
    title: "Journal",
    sub: "Daily entries with voice or text. One markdown file per day.",
  },
  "/memory": {
    title: "Memory",
    sub: "Search your Obsidian vault — notes, journal, goals, chat snapshots.",
  },
  "/events": {
    title: "Event log",
    sub: "Live agent invocations and audit envelopes as they happen.",
  },
};

/**
 * Convert a manifest-style slug like `claude-code` into a display-friendly
 * title like `Claude Code`. Used as:
 *   - the per-agent fallback when no static `resolveTitle` entry exists, and
 *   - the synchronous header fallback in `AgentRoom` while the manifest
 *     fetch is still in flight (avoids a brief "hermes"/"claude-code"
 *     slug flash on first paint).
 */
export function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function resolveTitle(pathname: string): PageIdentity {
  const exact = STATIC[pathname];
  if (exact) return exact;

  // Dynamic agent workspace: /agents/<name>
  const m = pathname.match(/^\/agents\/([^/]+)/);
  if (m && m[1]) {
    return {
      title: slugToTitle(m[1]),
      sub: "Per-agent workspace — chat or control room.",
    };
  }

  return STATIC["/"]!;
}
