// Connector family registration (M4a — PR2).
//
// Idempotent: a caller (the mission runner; later the /api/connectors routes)
// invokes ensureConnectorsRegistered() before touching the global connector
// registry, and re-running is a no-op against the global singleton. Tests
// using `__TEST__.newRegistry()` register their own families and never go
// through this path.
//
// M4a-2 registers the cli-acp-agent family. M4a-3a will add
// openai-compatible-llm here.

import { cliAcpAgentFamily } from "@/connectors/cli-acp-agent";
import { openAiCompatibleLlmFamily } from "@/connectors/openai-compatible-llm";
import { connectorRegistry } from "./registry";

export function ensureConnectorsRegistered(): void {
  if (!connectorRegistry.get("cli-acp-agent")) {
    connectorRegistry.register(cliAcpAgentFamily);
  }
  if (!connectorRegistry.get("openai-compatible-llm")) {
    connectorRegistry.register(openAiCompatibleLlmFamily);
  }
}
