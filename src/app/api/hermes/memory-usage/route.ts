// GET /api/hermes/memory-usage — character usage of Hermes's two
// personalization files (MEMORY.md, USER.md) against the caps declared
// in Hermes's own config.yaml. Read-only, fail-soft.
//
// Hermes ref: https://hermes-agent.nousresearch.com/docs/integrations/#memory--personalization
//
// Paths are fixed — no traversal surface. If Hermes isn't installed on
// this host (memories dir + config missing), `available: false` is
// returned and the UI hides the bars.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { originOk, forbidden } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERMES_MEMORY = path.join(os.homedir(), ".hermes", "memories", "MEMORY.md");
const HERMES_USER = path.join(os.homedir(), ".hermes", "memories", "USER.md");
const HERMES_CONFIG = path.join(os.homedir(), ".hermes", "config.yaml");

// Hermes ships with 5000 as the default for both caps; we still try the
// real config first so a user who's bumped the limit sees their actual
// budget reflected in the UI.
const DEFAULT_CAP = 5000;

async function charCount(p: string): Promise<number | null> {
  try {
    const buf = await fs.readFile(p, "utf8");
    return buf.length;
  } catch {
    return null;
  }
}

interface HermesMemoryConfig {
  memory_char_limit?: unknown;
  user_char_limit?: unknown;
}

async function readCaps(): Promise<{ memoryCap: number; userCap: number }> {
  try {
    const raw = await fs.readFile(HERMES_CONFIG, "utf8");
    const parsed = parseYaml(raw) as { memory?: HermesMemoryConfig } | null;
    const m = parsed?.memory ?? {};
    const memoryCap = typeof m.memory_char_limit === "number" && m.memory_char_limit > 0
      ? m.memory_char_limit
      : DEFAULT_CAP;
    const userCap = typeof m.user_char_limit === "number" && m.user_char_limit > 0
      ? m.user_char_limit
      : DEFAULT_CAP;
    return { memoryCap, userCap };
  } catch {
    return { memoryCap: DEFAULT_CAP, userCap: DEFAULT_CAP };
  }
}

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();

  const [memChars, userChars, caps] = await Promise.all([
    charCount(HERMES_MEMORY),
    charCount(HERMES_USER),
    readCaps(),
  ]);

  const available = memChars !== null || userChars !== null;

  return Response.json({
    ts: Date.now(),
    available,
    memory: {
      chars: memChars ?? 0,
      cap: caps.memoryCap,
      missing: memChars === null,
    },
    user: {
      chars: userChars ?? 0,
      cap: caps.userCap,
      missing: userChars === null,
    },
  });
}
