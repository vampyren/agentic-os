// Per-agent working-directory routes.
//
//   GET    /api/agents/<name>/cwd          → AgentCwdSnapshot
//   PUT    /api/agents/<name>/cwd          → { ok: true, path, warning? }
//                                            (body: { path: "<absolute path>" })
//   DELETE /api/agents/<name>/cwd          → 204 No Content
//                                            (revert to default $HOME/Documents)
//
// Same originOk CSRF gate as the rest of the agent routes. The unknown
// agent name returns 404 — we don't accept arbitrary slugs because the
// persisted JSON file becomes the source of truth for the kernel's
// spawn cwd, and we want unknown writes to fail loudly rather than
// poison the file with dead entries.

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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
  const { name } = await ctx.params;
  if (!(await ensureKnown(name))) {
    return Response.json({ error: `unknown agent: ${name}` }, { status: 404 });
  }
  const snap = await snapshotAgentCwd(name);
  return Response.json(snap);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
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
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
  const { name } = await ctx.params;
  if (!(await ensureKnown(name))) {
    return Response.json({ error: `unknown agent: ${name}` }, { status: 404 });
  }
  await clearAgentCwd(name);
  return new Response(null, { status: 204 });
}
