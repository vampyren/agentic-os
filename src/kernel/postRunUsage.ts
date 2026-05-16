// Post-run usage extractors. Some agents (Hermes today, others later)
// don't emit usage in their primary stdout — they store it elsewhere and
// expose a separate query path. After the main agent invocation succeeds,
// the transport runs the configured extractor and emits a `usage` event.
//
// Hard rules:
// - Extractor failures NEVER mark the agent call as failed. Worst case the
//   Tokens card just doesn't update. The operator already got their reply.
// - Extractors must not echo prompt content into the audit log. They only
//   read provider-side aggregates (model, token counts, cost).
// - All extractors return AgentUsage in the same shape as the streamJson
//   transport, so the UI consumes them identically.

import { safeSpawn } from "./spawn";
import type { AgentUsage } from "./types";

export type PostRunUsageParser = "hermes-session-export";

/**
 * Run the named extractor and return AgentUsage on success.
 * Returns undefined on any failure (caller treats as "no usage available").
 */
export async function runPostRunUsage(
  parser: PostRunUsageParser,
): Promise<AgentUsage | undefined> {
  try {
    switch (parser) {
      case "hermes-session-export":
        return await extractHermesUsage();
      default: {
        const _exhaustive: never = parser;
        return undefined;
      }
    }
  } catch {
    return undefined;                   // fail-soft per spec
  }
}

/**
 * Hermes extractor:
 *   1. `hermes sessions list --source cli --limit 1` → most recent CLI session id
 *      (single-operator system; very low chance of a competing CLI session
 *       between our `hermes -z` exit and this read)
 *   2. `hermes sessions export --session-id <id> -` → single-line JSON with
 *      model + token counts + cost
 *   3. Map to the AgentUsage shape (snake_case → camelCase)
 */
async function extractHermesUsage(): Promise<AgentUsage | undefined> {
  const list = await runCapture("hermes", ["sessions", "list", "--source", "cli", "--limit", "1"], 5000);
  if (!list.ok) return undefined;

  // Output looks like:
  //   Preview                              Last Active   Src    ID
  //   ────────────────────────────────────────────────────────────
  //   ...                                  4m ago        cli    20260516_164735_fd2846
  //
  // The session id is the last token of the data row. Take the last
  // non-empty line that doesn't start with whitespace/header markers.
  const id = parseSessionIdFromListOutput(list.stdout);
  if (!id) return undefined;

  const exp = await runCapture("hermes", ["sessions", "export", "--session-id", id, "-"], 5000);
  if (!exp.ok || !exp.stdout.trim()) return undefined;

  // Expecting a single JSON object on one line (or possibly more).
  // Take the first non-empty line that parses.
  for (const line of exp.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      return hermesSessionJsonToUsage(j);
    } catch {
      // skip
    }
  }
  return undefined;
}

export function parseSessionIdFromListOutput(stdout: string): string | undefined {
  const lines = stdout.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  // Walk from the bottom — the data rows come after the header + divider.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    // Header line contains "Preview" / "Src" / "ID".
    if (/\bID\b/.test(line) && /Preview|Source|Src/.test(line)) continue;
    // Divider lines are made of unicode box chars.
    if (/^[\s─\-=]+$/u.test(line)) continue;
    // Data line — id is the last token, looks like YYYYMMDD_HHMMSS_xxxxxx
    // or cron_xxx_YYYYMMDD_HHMMSS. Be permissive.
    const id = line.split(/\s+/).pop();
    if (id && /^[A-Za-z0-9_]+$/.test(id) && id.length >= 8) return id;
  }
  return undefined;
}

export function hermesSessionJsonToUsage(j: Record<string, unknown>): AgentUsage {
  const u: AgentUsage = {};
  if (typeof j["model"] === "string") u.model = j["model"];
  if (typeof j["input_tokens"] === "number") u.inputTokens = j["input_tokens"];
  if (typeof j["output_tokens"] === "number") u.outputTokens = j["output_tokens"];
  if (typeof j["cache_read_tokens"] === "number") u.cacheReadInputTokens = j["cache_read_tokens"];
  if (typeof j["cache_write_tokens"] === "number") u.cacheCreationInputTokens = j["cache_write_tokens"];
  const cost = j["actual_cost_usd"] ?? j["estimated_cost_usd"];
  if (typeof cost === "number") u.totalCostUsd = cost;
  return u;
}

async function runCapture(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = safeSpawn(bin, args);
    } catch {
      resolve({ ok: false, stdout: "", stderr: "" });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => out.push(b));
    child.stderr?.on("data", (b: Buffer) => err.push(b));
    try { child.stdin?.end(); } catch { /* ignore */ }
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve({ ok: false, stdout: "", stderr: "" });
    });
  });
}
