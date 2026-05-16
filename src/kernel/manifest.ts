// Agent manifest loader. Reads YAML from `agents/builtin/*.yaml` (shipped) and
// `~/.agentic-os/agents/*.yaml` (user overrides). User wins on name collision.
//
// Validation via zod — typos in user YAML fail at load time with a clear
// error pointing at the file.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import { z } from "zod";
import type { AgentManifest } from "./types";

const subprocessConfigSchema = z.object({
  bin: z.string().min(1),
  args: z.array(z.string()),
  timeoutMs: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const streamJsonConfigSchema = z.object({
  bin: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().optional(),
});

const healthProbeSchema = z.object({
  type: z.literal("command"),
  command: z.array(z.string()).nonempty(),
  timeoutMs: z.number().int().positive().max(10_000).optional(),
  intervalSec: z.number().int().positive().optional(),
});

// Optional post-run usage extractor. After the main agent call succeeds,
// the transport runs the named parser to fetch usage from a side channel
// (e.g. Hermes's SQLite store). Fail-soft: extractor errors never affect
// the main call's success.
const postRunUsageSchema = z.object({
  parser: z.enum(["hermes-session-export"]),
});

const manifestSchema = z.discriminatedUnion("transport", [
  z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "name must be kebab-case slug"),
    displayName: z.string().min(1),
    description: z.string().optional(),
    transport: z.literal("subprocess"),
    transportConfig: subprocessConfigSchema,
    capabilities: z.object({
      chat: z.boolean().optional(),
      streamingChat: z.boolean().optional(),
    }).optional(),
    healthProbe: healthProbeSchema.optional(),
    postRunUsage: postRunUsageSchema.optional(),
  }),
  z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "name must be kebab-case slug"),
    displayName: z.string().min(1),
    description: z.string().optional(),
    transport: z.literal("streamJson"),
    transportConfig: streamJsonConfigSchema,
    capabilities: z.object({
      chat: z.boolean().optional(),
      streamingChat: z.boolean().optional(),
    }).optional(),
    healthProbe: healthProbeSchema.optional(),
    postRunUsage: postRunUsageSchema.optional(),
  }),
]);

async function readManifestsFromDir(dir: string): Promise<AgentManifest[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];                          // dir doesn't exist → no manifests, not an error
  }
  const out: AgentManifest[] = [];
  for (const entry of entries) {
    if (!/\.ya?ml$/i.test(entry)) continue;
    const full = path.join(dir, entry);
    let raw: string;
    try {
      raw = await fs.readFile(full, "utf8");
    } catch (e) {
      throw new Error(`failed to read manifest ${full}: ${String(e)}`);
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (e) {
      throw new Error(`failed to parse manifest ${full}: ${String(e)}`);
    }
    const result = manifestSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`invalid manifest ${full}: ${result.error.message}`);
    }
    out.push(result.data as AgentManifest);
  }
  return out;
}

export interface LoadManifestsOpts {
  builtinDir?: string;                  // default: <cwd>/agents/builtin
  userDir?: string;                     // default: ~/.agentic-os/agents
}

export async function loadManifests(opts: LoadManifestsOpts = {}): Promise<AgentManifest[]> {
  const builtinDir = opts.builtinDir ?? path.join(process.cwd(), "agents", "builtin");
  const userDir = opts.userDir ?? path.join(os.homedir(), ".agentic-os", "agents");

  const [builtin, user] = await Promise.all([
    readManifestsFromDir(builtinDir),
    readManifestsFromDir(userDir),
  ]);

  // User overrides builtin on same name.
  const byName = new Map<string, AgentManifest>();
  for (const m of builtin) byName.set(m.name, m);
  for (const m of user) byName.set(m.name, m);
  return [...byName.values()];
}
