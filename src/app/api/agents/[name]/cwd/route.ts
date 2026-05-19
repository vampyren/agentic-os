// Per-agent working-directory routes.
//
//   GET    /api/agents/<name>/cwd          → AgentCwdSnapshot
//   PUT    /api/agents/<name>/cwd          → { ok: true, path, warning?, snapshot }
//                                            (body: { path: "<absolute path>" })
//   DELETE /api/agents/<name>/cwd          → 204 No Content
//                                            (revert to per-agent default
//                                             — for Claude: ~/Documents-or-$HOME;
//                                             for other agents: transport-level
//                                             cfg.cwd / process default)
//
// Same originOk CSRF gate as the rest of the agent routes. Unknown
// agent names return 404 — we don't accept arbitrary slugs because
// the persisted JSON becomes the kernel's source of truth for the
// spawn cwd and we want unknown writes to fail loudly rather than
// poison the file with dead entries.
//
// Every helper call is wrapped in try/catch so an unexpected I/O
// error (disk full, EPERM, etc.) returns a structured JSON 500 to
// the operator rather than an unhandled exception. The
// fail-soft contract in agentCwd.ts only covers READ paths; WRITES
// can fail and must be reported as a proper API error.

import { registry } from "@/kernel/registry";
import {
  clearAgentCwd,
  setAgentCwd,
  snapshotAgentCwd,
} from "@/kernel/agentCwd";
import { originOk, forbidden } from "../../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureKnown(name: string): Promise<boolean> {
  await registry.init();
  return Boolean(registry.get(name));
}

function internalError(e: unknown): Response {
  return Response.json(
    { ok: false, error: `internal error: ${String(e)}` },
    { status: 500 },
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
  try {
    const { name } = await ctx.params;
    if (!(await ensureKnown(name))) {
      return Response.json({ error: `unknown agent: ${name}` }, { status: 404 });
    }
    const snap = await snapshotAgentCwd(name);
    return Response.json(snap);
  } catch (e) {
    return internalError(e);
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
  try {
    const { name } = await ctx.params;
    if (!(await ensureKnown(name))) {
      return Response.json({ error: `unknown agent: ${name}` }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const candidate = (body as { path?: unknown })?.path;
    const result = await setAgentCwd(name, candidate);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    // Echo the snapshot so the UI gets the canonical view in one round-trip.
    const snap = await snapshotAgentCwd(name);
    return Response.json({
      ok: true,
      path: result.path,
      warning: result.warning,
      snapshot: snap,
    });
  } catch (e) {
    return internalError(e);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
  try {
    const { name } = await ctx.params;
    if (!(await ensureKnown(name))) {
      return Response.json({ error: `unknown agent: ${name}` }, { status: 404 });
    }
    await clearAgentCwd(name);
    return new Response(null, { status: 204 });
  } catch (e) {
    return internalError(e);
  }
}
