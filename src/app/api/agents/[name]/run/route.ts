// POST /api/agents/[name]/run — invoke an agent. Response is NDJSON, one
// JSON event per line:
//
//   { kind: "token", text: "..." }
//   { kind: "error", message: "..." }
//   { kind: "done", durationMs: N, exitCode: 0 }
//   { kind: "saved", path: "00_Inbox/agentic-os/chats/...", bytes: N }
//
// The final "saved" event is emitted after the registry stream completes and
// the chat is written to the operator's vault per the inbox-first contract.

import { registry } from "@/kernel/registry";
import { loadConfig } from "@/kernel/config";
import { getAgentCwd } from "@/kernel/agentCwd";
import { writeDraft } from "@/vault/writer";
import { originOk, forbidden } from "../../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT = 16_000;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const prompt = (body as { prompt?: unknown })?.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return new Response(`prompt too long (max ${MAX_PROMPT} chars)`, { status: 413 });
  }

  await registry.init();
  const { name } = await ctx.params;
  if (!registry.get(name)) {
    return Response.json({ error: `unknown agent: ${name}` }, { status: 404 });
  }

  let cfg;
  try {
    cfg = await loadConfig();
  } catch (e) {
    return Response.json({ error: `config error: ${String(e)}` }, { status: 500 });
  }

  // Resolve the per-agent cwd. `getAgentCwd` returns:
  //   - the persisted value (if set + still a valid directory), OR
  //   - the per-agent default (Claude → ~/Documents-or-$HOME), OR
  //   - undefined (Hermes / agents with no configured default).
  // We only pass `cwd` in StreamOpts when it's defined — otherwise the
  // transport's `opts.cwd ?? cfg.cwd` chain correctly falls through to
  // the manifest's own cwd (or the parent process's cwd). The earlier
  // Slice E implementation always returned a path, which silently
  // overrode every agent's transport-level cwd and was caught in
  // Jarvis's review.
  const cwd = await getAgentCwd(name);

  const enc = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => {
    controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
  };

  let fullText = "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Pass `cwd` only when defined — see comment above for why.
        const streamOpts = cwd !== undefined
          ? { prompt, cwd, signal: req.signal }
          : { prompt, signal: req.signal };
        for await (const evt of registry.stream(name, streamOpts)) {
          if (evt.kind === "token") fullText += evt.text;
          send(controller, evt);
        }
        // Persist the chat to vault after the agent finishes. Pass the full
        // prompt as filenameSeed so the chat filename's hash suffix is
        // computed over the entire prompt, not just the truncated title.
        // (The title still becomes the H1 inside the file; only the
        // filename is hashed for audit-log privacy.)
        try {
          const result = await writeDraft({
            vaultRoot: cfg.vault.root,
            agent: name,
            kind: "chat",
            title: prompt.slice(0, 60).replace(/\s+/g, " ").trim(),
            filenameSeed: prompt,
            body:
              `## prompt\n\n${prompt}\n\n` +
              `## response\n\n${fullText.trim() || "(empty)"}\n`,
          });
          send(controller, { kind: "saved", path: result.path, bytes: result.bytes });
        } catch (e) {
          send(controller, { kind: "error", message: `vault write failed: ${String(e)}` });
        }
      } catch (e) {
        send(controller, { kind: "error", message: String(e) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — request signal will abort the underlying child.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
