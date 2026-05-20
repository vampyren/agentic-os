// Agentic OS application config schema (Phase 1C — Milestone 1).
//
// This is the versioned, validated shape of ~/.agentic-os/config.yaml.
// M1 establishes the schema FOUNDATION only: the `features`, `connectors`,
// `mcpServers` and `permissions` sections exist with safe defaults so
// later milestones can populate them, but their item-level shapes are
// intentionally loose (`z.record(z.unknown())`) until the milestone that
// gives them real meaning:
//   - connector item schema → M2 (registry triad)
//   - mission item schema   → M3 (mission planning)
//
// Backward compatibility: a v0.2.12 config (just `vault` + `agents`) is a
// strict subset of this schema's allowed keys, so it still validates. The
// new sections all carry `.default(...)`, so an old file loads unchanged
// and simply gains the safe defaults.
//
// configVersion: the real forward-guard check + tailored error messaging
// lives in config.ts (`assertSupportedConfigVersion`), which runs BEFORE
// this schema. The field here is `z.literal(1)` purely so the resolved
// type carries `configVersion: 1`.

import { z } from "zod";
import {
  connectorsConfigSchema,
  mcpServersConfigSchema,
} from "../connectors/schema";
import { schedulerFeatureSchema } from "./scheduler";

/**
 * The highest `configVersion` this build understands. A config declaring
 * a higher version is refused at startup (forward guard) — see
 * `assertSupportedConfigVersion` in config.ts.
 */
export const SUPPORTED_CONFIG_VERSION = 1;

// ── features.scheduler ──────────────────────────────────────────────
// M3: the scheduler feature config (enable flag, timezone, and a real
// per-mission schema) is owned by src/kernel/schemas/scheduler.ts —
// imported above. M1's loose `missions: z.record(z.unknown())` is
// replaced there with cron + outputFolder validation.
const featuresSchema = z
  .object({
    scheduler: schedulerFeatureSchema,
  })
  .strict()
  .default({});

// ── connectors / mcpServers ─────────────────────────────────────────
// M2: the loose `z.record(z.unknown())` placeholders from M1 are
// replaced with the real item schemas (connectors/schema.ts). These
// describe operator SETTINGS (enabled / authRef / trust override /
// config references); connector definitions themselves are registered
// in code.
//
// connectors/schema.ts is the schema home, imported here so a single
// `connectors:` / `mcpServers:` block is validated as part of the
// whole-config parse.

// ── permissions ─────────────────────────────────────────────────────
// Declarative shape only — runtime enforcement comes in a later phase.
// Defaults are deliberately the safe end of each axis (deny / inbox-only
// / prompt).
const permissionsSchema = z
  .object({
    defaults: z
      .object({
        externalApi: z.enum(["prompt", "allow", "deny"]).default("prompt"),
        localProcess: z.enum(["allow", "deny"]).default("deny"),
        vaultWrite: z
          .enum(["inbox-only", "full-vault", "deny"])
          .default("inbox-only"),
        network: z
          .enum(["allow", "deny-localhost-private", "deny"])
          .default("deny-localhost-private"),
      })
      .strict()
      .default({}),
  })
  .strict()
  .default({});

// ── top-level config ────────────────────────────────────────────────
export const appConfigSchema = z
  .object({
    // Optional in the file; absent is treated as 1. config.ts owns the
    // forward-guard messaging, so by the time the file reaches this
    // schema the version is already known-good.
    configVersion: z.literal(SUPPORTED_CONFIG_VERSION).optional().default(SUPPORTED_CONFIG_VERSION),

    vault: z.object({
      root: z.string().min(1, "vault.root is required"),
    }),

    agents: z
      .object({
        default: z.string().optional(),
      })
      .optional()
      .default({}),

    features: featuresSchema,
    connectors: connectorsConfigSchema,
    mcpServers: mcpServersConfigSchema,
    permissions: permissionsSchema,
  })
  .strict()
  // Cross-section validation: every connector that references an MCP
  // server by name must point at a server actually declared under
  // `mcpServers`. A dangling reference is an operator typo that would
  // otherwise only surface much later — fail it at config-load time.
  .superRefine((cfg, ctx) => {
    const declared = new Set(Object.keys(cfg.mcpServers));
    for (const [connectorId, settings] of Object.entries(cfg.connectors)) {
      const ref = settings.mcpServer;
      if (ref !== undefined && !declared.has(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["connectors", connectorId, "mcpServer"],
          message:
            `connector "${connectorId}" references mcpServer "${ref}", ` +
            `which is not declared under mcpServers`,
        });
      }
    }
  });

/**
 * The loaded, defaulted application config. M2 validates connector
 * operator settings but still does NOT resolve secrets / `authRef`s —
 * secret resolution belongs to the later runtime connector/auth layer.
 * For now this single type is what `loadConfig()` returns.
 */
export type AppConfig = z.infer<typeof appConfigSchema>;
