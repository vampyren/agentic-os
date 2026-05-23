// Connector preset catalog (M4a — PR3a, spec §13 / §5.10).
//
// A preset is a declarative pre-fill of a connector's settings — picked from a
// catalog by an operator at Add-Provider time. PR3a ships the catalog
// mechanism + first-party JSON presets; the Add-Provider API + UI land in
// PR3b / PR3c.
//
// Trust clamp (B8): first-party presets ship in the build's `presets/` dir.
// Presets dropped into `~/.agentic-os/presets/` are clamped DOWNWARD only —
// the clamp never UPGRADES trust:
//   * `first-party` -> `community`   (with a neutral log line)
//   * `community`   -> `community`   (unchanged)
//   * `untrusted`   -> `untrusted`   (stays; upgrading to community would
//                                     be wrong — caught by the PR #20 review)
//
// Secret-key screening (B4): a preset whose `defaultSettings` has a
// secret-looking key (apiKey / token / …) at any depth is SKIPPED neutrally
// (logged, not fatal to the rest of the catalog).

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { CapabilityIdSchema, type CapabilityId } from "../capabilities/types";
import type { ConnectorTypeFamily } from "./types";
import { findSecretLookingKey } from "./secretKeys";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ConnectorPreset {
  id: string;
  label: string;
  description?: string;
  typeFamily: ConnectorTypeFamily;
  defaultSettings: Record<string, unknown>;
  /** Seeds the instance's effective capability narrowing (spec §5). */
  capabilities?: CapabilityId[];
  /** Preset-level SSRF opt-in for HTTP families. */
  allowLocalNetwork?: boolean;
  /** Hint to the Add-Provider UI (PR3c). */
  authPrompt?: {
    apiKeyEnvVar?: { label: string; helpUrl?: string };
    baseUrl?: { label: string; default?: string };
  };
  trust: "first-party" | "community" | "untrusted";
}

const presetSchema = z
  .object({
    id: z.string().regex(SLUG, "preset id must be a kebab-case slug"),
    label: z.string().min(1),
    description: z.string().optional(),
    typeFamily: z.enum(["cli-acp-agent", "openai-compatible-llm"]),
    defaultSettings: z
      .record(z.string(), z.unknown())
      .superRefine((val, ctx) => {
        const hit = findSecretLookingKey(val);
        if (hit) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `preset defaultSettings has a secret-looking key (${hit})`,
          });
        }
      }),
    capabilities: z.array(CapabilityIdSchema).optional(),
    allowLocalNetwork: z.boolean().optional(),
    authPrompt: z
      .object({
        apiKeyEnvVar: z
          .object({ label: z.string(), helpUrl: z.string().optional() })
          .optional(),
        baseUrl: z
          .object({ label: z.string(), default: z.string().optional() })
          .optional(),
      })
      .strict()
      .optional(),
    trust: z.enum(["first-party", "community", "untrusted"]),
  })
  .strict();

export interface LoadPresetsOpts {
  /** First-party preset directory; defaults to the build's `presets/`. */
  firstPartyDir?: string;
  /** Operator preset directory; defaults to `~/.agentic-os/presets/`. */
  userDir?: string;
}

function defaultFirstPartyDir(): string {
  // The repo's `presets/` directory; resolved from CWD. The Add-Provider
  // entrypoint can override via opts in PR3b.
  return path.join(process.cwd(), "presets");
}

function defaultUserDir(): string {
  return (
    process.env["AGENTIC_OS_PRESETS_DIR"]
    ?? path.join(os.homedir(), ".agentic-os", "presets")
  );
}

async function readJsonFiles(dir: string): Promise<Array<{ file: string; raw: unknown }>> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ file: string; raw: unknown }> = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const text = await fs.readFile(path.join(dir, name), "utf8");
      out.push({ file: name, raw: JSON.parse(text) });
    } catch {
      console.error(`[presets] could not read ${name}`);
    }
  }
  return out;
}

/**
 * Load all presets from the first-party directory and the user directory.
 * User-loaded presets are CLAMPED to `community` (B8). Schema-invalid or
 * secret-key-bearing presets are SKIPPED neutrally.
 */
export async function loadPresets(
  opts: LoadPresetsOpts = {},
): Promise<ConnectorPreset[]> {
  const firstPartyDir = opts.firstPartyDir ?? defaultFirstPartyDir();
  const userDir = opts.userDir ?? defaultUserDir();

  const out: ConnectorPreset[] = [];

  for (const { file, raw } of await readJsonFiles(firstPartyDir)) {
    const parsed = presetSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[presets] first-party preset ${file} is invalid; skipping`);
      continue;
    }
    out.push(parsed.data);
  }

  for (const { file, raw } of await readJsonFiles(userDir)) {
    const parsed = presetSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[presets] user preset ${file} is invalid; skipping`);
      continue;
    }
    // Trust clamp: ONLY downward, never upward (B8 / review fix). A user-
    // loaded preset declaring `first-party` is downgraded to `community`;
    // a `community` preset stays; an `untrusted` preset MUST remain
    // `untrusted` (forcing it to community would be an upgrade).
    let effectiveTrust: ConnectorPreset["trust"];
    switch (parsed.data.trust) {
      case "first-party":
        console.warn(
          `[presets] user preset ${file} declared first-party; clamped to community`,
        );
        effectiveTrust = "community";
        break;
      case "community":
        effectiveTrust = "community";
        break;
      case "untrusted":
        effectiveTrust = "untrusted";
        break;
    }
    out.push({ ...parsed.data, trust: effectiveTrust });
  }

  return out;
}
