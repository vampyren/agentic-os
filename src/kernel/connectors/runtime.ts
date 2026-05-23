// ConnectorRuntime (M4a-1, spec §5).
//
// Resolves a connector INSTANCE (operator config) against its FAMILY (code)
// and server-resolved auth into an invocable instance:
//
//   ConnectorFamilyDefinition  (code)    + a config.connectors entry (config)
//   + resolved authRef (runtime)         -> ResolvedConnectorInstance
//
// A misconfigured instance never reaches a connector — buildConnectorContext
// returns a `misconfigured` ConnectorValidation and the router/test path
// fails closed.

import type { CapabilityId } from "../capabilities/types";
import type { ConnectorRegistry } from "./registry";
import type { ConnectorInstanceConfig, ConnectorsConfig } from "./schema";
import type {
  ConnectorFamilyDefinition,
  ConnectorInvokeContext,
  ConnectorTrust,
  ConnectorValidation,
} from "./types";
import { resolveAuthRef } from "./authRef";
import { findSecretLookingKey } from "./secretKeys";

/** What the router invokes — a fully-resolved connector instance. */
export interface ResolvedConnectorInstance {
  connectorId: string;
  family: ConnectorFamilyDefinition;
  ctx: ConnectorInvokeContext;
  effectiveCapabilities: CapabilityId[];
  trust: ConnectorTrust;
}

export type BuildInstanceResult =
  | { ok: true; instance: ResolvedConnectorInstance }
  | { ok: false; validation: ConnectorValidation };

/** Optional preset seed (presets land in M4a-3a; M4a-1 passes none). */
export interface PresetSeed {
  defaultSettings?: Record<string, unknown>;
  capabilities?: CapabilityId[];
  allowLocalNetwork?: boolean;
}

function misconfigured(
  errorCode: NonNullable<ConnectorValidation["errorCode"]>,
  message: string,
): { ok: false; validation: ConnectorValidation } {
  return {
    ok: false,
    validation: {
      status: "misconfigured",
      errorCode,
      message,
      testedAt: new Date().toISOString(),
      durationMs: 0,
    },
  };
}

/** An operator trust override may only move trust DOWN, never up (B8 / req 7). */
function effectiveTrust(
  familyTrust: ConnectorTrust,
  override: ConnectorInstanceConfig["trustOverride"],
): ConnectorTrust {
  if (!override) return familyTrust;
  // override is "community" | "untrusted"; both are <= "first-party".
  if (familyTrust === "untrusted") return "untrusted";
  if (familyTrust === "community") {
    return override === "untrusted" ? "untrusted" : "community";
  }
  return override; // family first-party -> override applies as-is.
}

/**
 * Build the invocable context for one connector instance. Pure given its
 * inputs — no ledger, no HTTP. The SSRF guard for HTTP families is wired in
 * M4a-3a; M4a-1 connectors are subprocess-only.
 */
export function buildConnectorContext(
  connectorId: string,
  instanceConfig: ConnectorInstanceConfig,
  family: ConnectorFamilyDefinition,
  preset?: PresetSeed,
): BuildInstanceResult {
  // 1. Screen settings keys (B4) — a secret-looking key never reaches a family.
  if (instanceConfig.settings) {
    const hit = findSecretLookingKey(instanceConfig.settings);
    if (hit) {
      return misconfigured(
        "config-invalid",
        `settings contains a secret-looking key (${hit}); use authRef`,
      );
    }
  }

  // 2. Merge settings (instance over preset over family defaults) and parse
  //    through the family schema.
  const merged = {
    ...(family.defaultSettings as Record<string, unknown>),
    ...(preset?.defaultSettings ?? {}),
    ...(instanceConfig.settings ?? {}),
  };
  const parsed = family.settingsSchema.safeParse(merged);
  if (!parsed.success) {
    return misconfigured("config-invalid", "connector settings are invalid");
  }

  // 3. (HTTP families) SSRF guard on the resolved baseUrl — wired in M4a-3a.

  // 4. Resolve auth. The family may REQUIRE it; or the instance may have
  //    OPTIONALLY supplied an authRef (e.g. an OpenAI key on the shared
  //    openai-compatible-llm family that also serves no-auth Ollama). When
  //    optional authRef is supplied, the env var must resolve — a missing
  //    value is a misconfiguration, not silently ignored.
  let secret: string | undefined;
  const hasOptionalAuthRef =
    instanceConfig.authRef !== undefined && instanceConfig.authRef !== "none";
  if (family.auth.required || hasOptionalAuthRef) {
    const auth = resolveAuthRef(instanceConfig.authRef);
    if (!auth.ok) {
      return misconfigured(
        auth.errorCode === "auth-malformed" ? "config-invalid" : "auth-missing",
        "connector authentication is not configured",
      );
    }
    secret = auth.secret;
  }

  // 5. Effective capability set = family max ∩ (instance ?? preset ?? family).
  const narrow = instanceConfig.capabilities ?? preset?.capabilities;
  const familySet = new Set(family.capabilities);
  const effectiveCapabilities = narrow
    ? narrow.filter((c) => familySet.has(c))
    : [...family.capabilities];

  const ctx: ConnectorInvokeContext = {
    connectorId,
    typeFamily: family.id,
    settings: parsed.data,
    ...(secret !== undefined ? { secret } : {}),
  };

  return {
    ok: true,
    instance: {
      connectorId,
      family,
      ctx,
      effectiveCapabilities,
      trust: effectiveTrust(family.defaultTrust, instanceConfig.trustOverride),
    },
  };
}

export interface ResolvedEntry {
  connectorId: string;
  build: BuildInstanceResult;
}

/**
 * Resolve every ENABLED connector instance in config against its family.
 * Returns one entry per enabled instance — `ok` or `misconfigured` — so the
 * router can both dispatch ready instances and fail closed on broken ones.
 */
export function resolveConnectorInstances(
  registry: ConnectorRegistry,
  connectorsConfig: ConnectorsConfig,
): ResolvedEntry[] {
  const entries: ResolvedEntry[] = [];
  for (const [connectorId, instanceConfig] of Object.entries(connectorsConfig)) {
    if (!instanceConfig.enabled) continue;
    const family = registry.get(instanceConfig.typeFamily);
    if (!family) {
      entries.push({
        connectorId,
        build: misconfigured(
          "config-invalid",
          "connector type family is not registered",
        ),
      });
      continue;
    }
    entries.push({
      connectorId,
      build: buildConnectorContext(connectorId, instanceConfig, family),
    });
  }
  return entries;
}
