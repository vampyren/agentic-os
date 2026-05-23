// cli-acp-agent connector family (M4a — PR2 / M4a-2).
//
// One ConnectorFamilyDefinition; multiple operator INSTANCES (e.g.
// "claude-code", "hermes") configured in config.connectors with
// typeFamily: "cli-acp-agent". A `settings.agent` field names the agent
// registry manifest the instance binds to — the family delegates
// `agent.run` to `agentRegistry.chat()` and `testConnection` to
// `agentRegistry.health()`, reusing the existing subprocess transport
// (safeSpawn). NO second subprocess path.
//
// Local binaries — `auth.required: false`. No API key, no `authRef`.
//
// Returned failures stay NEUTRAL: no raw stderr / exit-code text / binary
// path appears in the ConnectorResult, ConnectorValidation, audit, or logs.
// The router's B13 sanitization is the second line of defence; this family
// is the first.

import { z } from "zod";
import { registry as defaultAgentRegistry } from "@/kernel/registry";
import type {
  ConnectorFamilyDefinition,
  ConnectorInvokeContext,
  ConnectorResult,
  ConnectorValidation,
} from "@/kernel/connectors/types";
import { invokeHermesKanban, type AgentManifestLookup } from "./hermes-kanban";

const settingsSchema = z
  .object({
    agent: z
      .string()
      .min(1, "settings.agent must name a registered agent manifest"),
  })
  .strict();

type Settings = z.infer<typeof settingsSchema>;

function readSettings(ctx: ConnectorInvokeContext): Settings | null {
  const parsed = settingsSchema.safeParse(ctx.settings);
  return parsed.success ? parsed.data : null;
}

function isPromptInput(input: unknown): input is { prompt: string } {
  return (
    typeof input === "object"
    && input !== null
    && typeof (input as { prompt?: unknown }).prompt === "string"
    && (input as { prompt: string }).prompt.length > 0
  );
}

export interface CliAcpAgentDeps {
  /** Inject the agent registry (test seam); production uses the global one. */
  agentRegistry?: typeof defaultAgentRegistry;
}

/** Build a cli-acp-agent family. Production callers use {@link cliAcpAgentFamily}. */
export function createCliAcpAgentFamily(
  deps: CliAcpAgentDeps = {},
): ConnectorFamilyDefinition {
  const agentRegistry = deps.agentRegistry ?? defaultAgentRegistry;

  return {
    id: "cli-acp-agent",
    title: "CLI/ACP Agent",
    kind: "managed-agent",
    transport: "subprocess",
    // Family-level MAXIMUM capability set. The Hermes instance keeps all
    // four; the Claude Code instance MUST narrow to [agent.run] in its
    // config (the family will refuse kanban for an agent it can't fulfil,
    // but operators should narrow up front — the connector list reflects
    // the effective set).
    capabilities: [
      "agent.run",
      "kanban.board.list",
      "kanban.task.list",
      "kanban.task.show",
    ],
    sideEffects: ["local-process"],
    defaultTrust: "first-party",
    settingsSchema,
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },

    async invoke(ctx, capability, input): Promise<ConnectorResult> {
      // Kanban: delegate to the Hermes-specific dispatcher. The agent bin
      // is the same one the manifest declares — no second subprocess path;
      // `safeSpawn` is the shared spawn helper. Read-only set only —
      // `kanban.task.create` is declared in CapabilityIdSchema but has no
      // implementation here, so the router returns capability-not-supported.
      if (
        capability === "kanban.board.list"
        || capability === "kanban.task.list"
        || capability === "kanban.task.show"
      ) {
        return invokeHermesKanban(
          ctx,
          capability,
          input,
          buildAgentLookup(agentRegistry),
        );
      }

      if (capability !== "agent.run") {
        return { status: "failed", errorCode: "capability-not-supported" };
      }
      const settings = readSettings(ctx);
      if (!settings) return { status: "failed", errorCode: "config-invalid" };
      if (!isPromptInput(input)) {
        return { status: "failed", errorCode: "config-invalid" };
      }

      try {
        const result = await agentRegistry.chat(settings.agent, {
          prompt: input.prompt,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        if (result.exitCode === 0) {
          return {
            status: "success",
            output: { text: result.text, durationMs: result.durationMs },
          };
        }
        // Non-zero exit — a real failure. The agent registry's `chat()` does
        // NOT surface raw stderr in its return value (the subprocess transport
        // yields an `error` event that chat() does not collect), so no raw
        // text is here to leak. The router's B13 path neutralises the
        // returned failure regardless.
        console.error("[cli-acp-agent] agent.run failed (non-zero exit)");
        return { status: "failed", errorCode: "external-system-unavailable" };
      } catch {
        console.error("[cli-acp-agent] agent.run threw");
        return { status: "failed", errorCode: "external-system-unavailable" };
      }
    },

    async testConnection(ctx): Promise<ConnectorValidation> {
      const startedAt = Date.now();
      const testedAt = new Date().toISOString();
      const settings = readSettings(ctx);
      if (!settings) {
        return {
          status: "misconfigured",
          errorCode: "config-invalid",
          testedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      try {
        // HealthReport.message can carry raw stderr / spawn-error text —
        // NEVER passed through to the validation. We only consult `.status`.
        const health = await agentRegistry.health(settings.agent);
        const durationMs = Date.now() - startedAt;
        switch (health.status) {
          case "live":
            return { status: "valid", testedAt, durationMs };
          case "degraded":
            return {
              status: "unreachable",
              errorCode: "external-system-unavailable",
              testedAt,
              durationMs,
            };
          case "offline":
            // Subprocess transport reports `offline` on a spawn error (ENOENT
            // / EACCES / etc.) — i.e. the binary is not available.
            return {
              status: "unreachable",
              errorCode: "binary-not-found",
              testedAt,
              durationMs,
            };
          case "unknown":
          default:
            return {
              status: "unknown",
              errorCode: "unknown",
              testedAt,
              durationMs,
            };
        }
      } catch {
        return {
          status: "unreachable",
          errorCode: "external-system-unavailable",
          testedAt,
          durationMs: Date.now() - startedAt,
        };
      }
    },
  };
}

/**
 * Build the {@link AgentManifestLookup} the Hermes kanban dispatcher needs —
 * resolves an agent manifest name to its `bin` via the agent registry, so
 * the kanban code uses the SAME binary path the operator's manifest already
 * declared (no second config surface).
 */
function buildAgentLookup(
  agentRegistry: typeof defaultAgentRegistry,
): AgentManifestLookup {
  return {
    binFor(agentName: string): string | null {
      const entry = agentRegistry.get(agentName);
      if (!entry) return null;
      const cfg = entry.manifest.transportConfig as { bin?: unknown };
      return typeof cfg.bin === "string" ? cfg.bin : null;
    },
  };
}

/** The production cli-acp-agent family, bound to the global agent registry. */
export const cliAcpAgentFamily: ConnectorFamilyDefinition = createCliAcpAgentFamily();
