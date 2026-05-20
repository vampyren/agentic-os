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

/**
 * The highest `configVersion` this build understands. A config declaring
 * a higher version is refused at startup (forward guard) — see
 * `assertSupportedConfigVersion` in config.ts.
 */
export const SUPPORTED_CONFIG_VERSION = 1;

// ── features.scheduler ──────────────────────────────────────────────
// M1: the scheduler feature exists with an enable flag and an (empty)
// mission map. Per-mission config shape lands in M3 — until then a
// mission entry is accepted but not validated internally.
const schedulerFeatureSchema = z
  .object({
    enabled: z.boolean().default(false),
    missions: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .default({});

const featuresSchema = z
  .object({
    scheduler: schedulerFeatureSchema,
  })
  .strict()
  .default({});

// ── connectors / mcpServers ─────────────────────────────────────────
// M1: declared as empty maps. Item schemas (kind, transport, authRef,
// capabilities, …) land with the connector registry in M2. Loose record
// here so a user who hand-adds a connectors block doesn't break loading.
const connectorsSchema = z.record(z.string(), z.unknown()).default({});
const mcpServersSchema = z.record(z.string(), z.unknown()).default({});

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
    connectors: connectorsSchema,
    mcpServers: mcpServersSchema,
    permissions: permissionsSchema,
  })
  .strict();

/**
 * The loaded, defaulted application config. Note: M1 does NOT resolve
 * secrets / `authRef`s — that transform (and a distinct `ResolvedAppConfig`
 * type) lands with the connector registry. For now this single type is
 * what `loadConfig()` returns.
 */
export type AppConfig = z.infer<typeof appConfigSchema>;
