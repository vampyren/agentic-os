// Per-agent accent color resolution. The CSS provides named variables for
// the agents we expect; for any other agent name we hash to one of the
// "default" rotation colors so two unrelated agents don't visually clash.

const KNOWN: Record<string, string> = {
  "claude-code":   "var(--accent-claude-code)",
  "hermes":        "var(--accent-hermes)",
  "openclaw":      "var(--accent-openclaw)",
  "chatgpt":       "var(--accent-chatgpt)",
  "openrouter":    "var(--accent-openrouter)",
};

const ROTATION = [
  "#94a3b8", "#22d3ee", "#a855f7", "#ec4899", "#10b981",
  "#f59e0b", "#d97757", "#6366f1", "#84cc16",
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

export function accentFor(agentName: string): string {
  if (KNOWN[agentName]) return KNOWN[agentName]!;
  return ROTATION[hashCode(agentName) % ROTATION.length]!;
}
