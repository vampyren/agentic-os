// Connector instance + MCP-server config schemas (M4a — connector runtime).
//
// A connector INSTANCE config (config.connectors.<connectorId>) describes the
// operator's settings for one connector: which type family it is, an optional
// preset seed, env-only authRef, family-shaped settings, an optional
// capability narrowing, a downward-only trust override, and (HTTP families) a
// local-network opt-in. Family kind / transport / capabilities live in CODE
// (connectors/types.ts).
//
// Two-phase validation (spec §5): this static schema validates the ENVELOPE
// and screens `settings` for secret-looking keys (B4); the family
// `settingsSchema` strictly re-parses `settings` in the runtime.

import { z } from "zod";
import { CapabilityIdSchema } from "../capabilities/types";
import { findSecretLookingKey } from "./secretKeys";

// Kebab-case slug — same convention as the agent manifest `name`.
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// authRef references a secret indirectly. `none` = no auth; `env:VAR` = read
// from the named environment variable at use time (resolved server-side).
const authRefSchema = z
  .string()
  .regex(
    /^(none|env:[A-Za-z_][A-Za-z0-9_]*)$/,
    "authRef must be `none` or `env:VAR_NAME`",
  );
export type AuthRef = z.infer<typeof authRefSchema>;

const connectorTypeFamilySchema = z.enum([
  "cli-acp-agent",
  "openai-compatible-llm",
]);

// `settings` is family config — it must never carry a secret. The B4 screen
// rejects a secret-looking key at any depth before the family schema runs.
const connectorSettingsBag = z
  .record(z.string(), z.unknown())
  .superRefine((val, ctx) => {
    const hit = findSecretLookingKey(val);
    if (hit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `connector settings may not contain a secret-looking key (${hit}) `
          + `— supply a secret via authRef, never inline`,
      });
    }
  });

// ── connector instance config (config.connectors.<connectorId>) ─────────────
export const connectorInstanceConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    typeFamily: connectorTypeFamilySchema,
    presetId: z.string().regex(SLUG, "presetId must be a kebab-case slug").optional(),
    authRef: authRefSchema.optional(),
    settings: connectorSettingsBag.optional(),
    // Narrows the family's capability set; absent => the family max set.
    capabilities: z.array(CapabilityIdSchema).optional(),
    // Operator trust override — DOWNWARD only (never first-party).
    trustOverride: z.enum(["community", "untrusted"]).optional(),
    // HTTP families only — opt-in past the SSRF guard (M4a-3a).
    allowLocalNetwork: z.boolean().optional(),
    // Name of an mcpServers entry this connector talks through (orthogonal).
    mcpServer: z
      .string()
      .regex(SLUG, "mcpServer must be a kebab-case slug")
      .optional(),
  })
  .strict();

export const connectorsConfigSchema = z
  .record(
    z.string().regex(SLUG, "connector id must be a kebab-case slug"),
    connectorInstanceConfigSchema,
  )
  .default({});

// ── MCP server settings (config.mcpServers.<id>) — unchanged from M2 ────────
export const mcpServerSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    command: z.string().min(1, "mcpServer.command is required"),
    args: z.array(z.string()).default([]),
    authRef: authRefSchema.optional(),
  })
  .strict();

export const mcpServersConfigSchema = z
  .record(
    z.string().regex(SLUG, "mcpServer id must be a kebab-case slug"),
    mcpServerSettingsSchema,
  )
  .default({});

export type ConnectorInstanceConfig = z.infer<typeof connectorInstanceConfigSchema>;
export type ConnectorsConfig = z.infer<typeof connectorsConfigSchema>;
/** Back-compat alias — prefer ConnectorInstanceConfig. */
export type ConnectorSettings = ConnectorInstanceConfig;
export type McpServerSettings = z.infer<typeof mcpServerSettingsSchema>;
export type McpServersConfig = z.infer<typeof mcpServersConfigSchema>;
