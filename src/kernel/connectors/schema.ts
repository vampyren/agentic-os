// Connector + MCP-server config schemas (Phase 1C — Milestone 2).
//
// These tighten the deliberately-loose `connectors` / `mcpServers`
// records M1 left as `z.record(z.unknown())`. They describe the
// OPERATOR SETTINGS for a connector / MCP server — NOT the connector
// definition itself (definitions are registered in code; see
// connectors/types.ts). Per the locked review decision: config
// supplies enable / authRef / trust override / config references;
// code supplies kind / transport / capabilities.
//
// authRef is SYNTAX-checked only (`env:NAME` or `none`) — never
// resolved into the config object. Secret resolution is a later phase.

import { z } from "zod";

// Kebab-case slug — same convention as the agent manifest `name`.
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// authRef references a secret indirectly. `none` = no auth needed;
// `env:VAR` = read from the named environment variable at use time.
const authRefSchema = z
  .string()
  .regex(
    /^(none|env:[A-Za-z_][A-Za-z0-9_]*)$/,
    "authRef must be `none` or `env:VAR_NAME`",
  );

const trustSchema = z.enum(["first-party", "community", "untrusted"]);

// ── connector settings (config.connectors.<id>) ─────────────────────
export const connectorSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    authRef: authRefSchema.optional(),
    // Operator override of the definition's declared trust level.
    trust: trustSchema.optional(),
    // Name of an mcpServers entry this connector talks through.
    mcpServer: z
      .string()
      .regex(SLUG, "mcpServer must be a kebab-case slug")
      .optional(),
    // Connector-specific settings — opaque at the config layer.
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const connectorsConfigSchema = z
  .record(
    z.string().regex(SLUG, "connector id must be a kebab-case slug"),
    connectorSettingsSchema,
  )
  .default({});

// ── MCP server settings (config.mcpServers.<id>) ────────────────────
// Minimal shape: enough to declare a server so a connector can
// reference it. NO process launch / runtime / health in M2.
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

export type ConnectorSettings = z.infer<typeof connectorSettingsSchema>;
export type ConnectorsConfig = z.infer<typeof connectorsConfigSchema>;
export type McpServerSettings = z.infer<typeof mcpServerSettingsSchema>;
export type McpServersConfig = z.infer<typeof mcpServersConfigSchema>;
