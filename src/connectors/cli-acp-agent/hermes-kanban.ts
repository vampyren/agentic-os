// Hermes read-only Kanban capabilities (M4a — PR4, spec §16).
//
// The cli-acp-agent family delegates `kanban.board.list` / `kanban.task.list`
// / `kanban.task.show` to the configured agent's binary (Hermes, in
// practice). We invoke `<bin> kanban <subcommand>` through the existing
// `safeSpawn` helper — NO second subprocess path — and parse JSON from
// stdout. Stderr / exit-code text / raw filesystem paths NEVER cross into
// the result; on any failure the connector returns a NEUTRAL
// ConnectorResult that the router's B13 path then collapses to a sanitized
// failure.
//
// Read-only on purpose: M4a does NOT implement `kanban.task.create`;
// allowWrites stays false. M4a-4 keeps the kanban surface scoped tightly
// (spec §3.3).

import { z } from "zod";
import type { ConnectorInvokeContext, ConnectorResult } from "@/kernel/connectors/types";
import type { CapabilityId } from "@/kernel/capabilities/types";
import { safeSpawn } from "@/kernel/spawn";

const KANBAN_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 1_000_000; // 1 MB cap — defensive cap on JSON output.

const SLUG_LIKE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Public interfaces the family exposes — type-only contracts, no impl. */
interface HermesBoard { id: string; name: string }
interface HermesTask {
  id: string;
  title: string;
  status?: string;
  board?: string;
  externalRef?: { system: "hermes"; kind: string; id: string };
}

export interface AgentManifestLookup {
  /** Returns the agent's bin (safeSpawn target) or null when unknown. */
  binFor(agentName: string): string | null;
}

interface RunResult {
  ok: true;
  stdout: string;
}
interface RunFailure {
  ok: false;
  errorCode:
    | "binary-not-found"
    | "external-system-unavailable"
    | "network-unreachable";
}

/** Spawn `<bin> <args…>`, collect bounded stdout, neutralise everything else. */
async function runHermes(
  bin: string,
  args: string[],
  signal: AbortSignal | undefined,
): Promise<RunResult | RunFailure> {
  let child;
  try {
    child = safeSpawn(bin, args, signal ? { signal } : {});
  } catch {
    return { ok: false, errorCode: "binary-not-found" };
  }

  const stdoutChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let overBudget = false;
  const timeout = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }, KANBAN_TIMEOUT_MS);

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      if (!overBudget) {
        overBudget = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
      return;
    }
    stdoutChunks.push(chunk);
  });
  // Stderr is read and discarded — NEVER surfaced in the result/audit/log.
  child.stderr?.on("data", () => {});
  try { child.stdin?.end(); } catch { /* ignore */ }

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));
  });
  clearTimeout(timeout);

  if (overBudget) {
    return { ok: false, errorCode: "external-system-unavailable" };
  }
  if (exitCode !== 0) {
    return { ok: false, errorCode: "external-system-unavailable" };
  }
  return { ok: true, stdout: Buffer.concat(stdoutChunks).toString("utf8") };
}

function safeParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ── Per-capability output shapes ──────────────────────────────────────────

const boardListInputSchema = z.object({}).strict().or(z.undefined());
const taskListInputSchema = z
  .object({
    boardId: z.string().regex(SLUG_LIKE).optional(),
  })
  .strict();
const taskShowInputSchema = z
  .object({
    taskId: z.string().regex(SLUG_LIKE).min(1),
  })
  .strict();

function projectBoard(raw: unknown): HermesBoard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  return { id: r.id, name: r.name };
}

function projectTask(raw: unknown): HermesTask | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  const task: HermesTask = { id: r.id, title: r.title };
  if (typeof r.status === "string") task.status = r.status;
  if (typeof r.board === "string") task.board = r.board;
  task.externalRef = { system: "hermes", kind: "task", id: r.id };
  return task;
}

// ── Dispatcher — called from the cli-acp-agent family's invoke. ───────────

export async function invokeHermesKanban(
  ctx: ConnectorInvokeContext,
  capability: CapabilityId,
  input: unknown,
  lookup: AgentManifestLookup,
): Promise<ConnectorResult> {
  const settings = ctx.settings as { agent?: string } | undefined;
  if (typeof settings?.agent !== "string") {
    return { status: "failed", errorCode: "config-invalid" };
  }
  const bin = lookup.binFor(settings.agent);
  if (!bin) {
    return { status: "failed", errorCode: "external-system-unavailable" };
  }

  switch (capability) {
    case "kanban.board.list": {
      if (!boardListInputSchema.safeParse(input).success) {
        return { status: "failed", errorCode: "config-invalid" };
      }
      const r = await runHermes(bin, ["kanban", "list-boards"], ctx.signal);
      if (!r.ok) return { status: "failed", errorCode: r.errorCode };
      const parsed = safeParseJson(r.stdout) as { boards?: unknown } | null;
      const rawBoards = Array.isArray(parsed?.boards) ? parsed!.boards : null;
      if (!rawBoards) {
        return { status: "failed", errorCode: "external-system-unavailable" };
      }
      const boards = rawBoards.map(projectBoard).filter((b): b is HermesBoard => b !== null);
      return { status: "success", output: { boards } };
    }

    case "kanban.task.list": {
      const parsedInput = taskListInputSchema.safeParse(input ?? {});
      if (!parsedInput.success) {
        return { status: "failed", errorCode: "config-invalid" };
      }
      const args = ["kanban", "list-tasks"];
      if (parsedInput.data.boardId) {
        args.push("--board", parsedInput.data.boardId);
      }
      const r = await runHermes(bin, args, ctx.signal);
      if (!r.ok) return { status: "failed", errorCode: r.errorCode };
      const parsed = safeParseJson(r.stdout) as { tasks?: unknown } | null;
      const rawTasks = Array.isArray(parsed?.tasks) ? parsed!.tasks : null;
      if (!rawTasks) {
        return { status: "failed", errorCode: "external-system-unavailable" };
      }
      const tasks = rawTasks.map(projectTask).filter((t): t is HermesTask => t !== null);
      return { status: "success", output: { tasks } };
    }

    case "kanban.task.show": {
      const parsedInput = taskShowInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return { status: "failed", errorCode: "config-invalid" };
      }
      const r = await runHermes(
        bin,
        ["kanban", "show-task", parsedInput.data.taskId],
        ctx.signal,
      );
      if (!r.ok) return { status: "failed", errorCode: r.errorCode };
      const parsed = safeParseJson(r.stdout) as { task?: unknown } | null;
      const task = parsed?.task ? projectTask(parsed.task) : null;
      if (!task) {
        return { status: "failed", errorCode: "external-system-unavailable" };
      }
      return { status: "success", output: { task } };
    }

    default:
      return { status: "failed", errorCode: "capability-not-supported" };
  }
}
