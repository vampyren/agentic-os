// /api/connectors — list/add/presets + the [id]/test route.
//
// Exercises the real route handlers with fully isolated env: a tmp config
// path (AGENTIC_OS_CONFIG), tmp first-party + user preset dirs
// (AGENTIC_OS_FIRST_PARTY_PRESETS_DIR / AGENTIC_OS_PRESETS_DIR), a tmp
// state DB (AGENTIC_OS_STATE_DB) and a tmp audit dir (AGENTIC_OS_AUDIT_DIR).
// The real ~/.agentic-os is never touched. SSRF tests use IP-literal
// baseUrls only — no DNS calls.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { closeStateDbForTests } from "../src/kernel/state/db";
import { resetRunLedgerForTests } from "../src/kernel/state/runLedger";
import { GET as listConnectors, POST as addConnector } from "../src/app/api/connectors/route";
import { GET as listPresets } from "../src/app/api/connectors/presets/route";
import { POST as testConnector } from "../src/app/api/connectors/[id]/test/route";

const BASE = "http://127.0.0.1:3000/api/connectors";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let tmpDir: string;
let configPath: string;
let firstPartyDir: string;
let userPresetsDir: string;
let auditDir: string;
let stateDbPath: string;
let vaultRoot: string;

let originalConfig: string | undefined;
let originalFirstParty: string | undefined;
let originalUser: string | undefined;
let originalAudit: string | undefined;
let originalStateDb: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-connectors-"));
  configPath = path.join(tmpDir, "config.yaml");
  firstPartyDir = path.join(tmpDir, "presets-first");
  userPresetsDir = path.join(tmpDir, "presets-user");
  auditDir = path.join(tmpDir, "audit");
  stateDbPath = path.join(tmpDir, "state.db");
  vaultRoot = path.join(tmpDir, "vault");
  await fs.mkdir(firstPartyDir, { recursive: true });
  await fs.mkdir(userPresetsDir, { recursive: true });
  await fs.mkdir(auditDir, { recursive: true });
  await fs.mkdir(path.join(vaultRoot, "00_Inbox", "agentic-os"), { recursive: true });

  originalConfig = process.env.AGENTIC_OS_CONFIG;
  originalFirstParty = process.env.AGENTIC_OS_FIRST_PARTY_PRESETS_DIR;
  originalUser = process.env.AGENTIC_OS_PRESETS_DIR;
  originalAudit = process.env.AGENTIC_OS_AUDIT_DIR;
  originalStateDb = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_CONFIG = configPath;
  process.env.AGENTIC_OS_FIRST_PARTY_PRESETS_DIR = firstPartyDir;
  process.env.AGENTIC_OS_PRESETS_DIR = userPresetsDir;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;
  process.env.AGENTIC_OS_STATE_DB = stateDbPath;

  // Default starting config — vault + scheduler enabled + one pre-existing
  // connector (used by the preserve-unrelated-config test).
  await writeYaml(configPath,
    `vault:\n  root: ${vaultRoot}\n`
    + `features:\n  scheduler:\n    enabled: true\n`
    + `connectors:\n  preexisting:\n    enabled: false\n    typeFamily: cli-acp-agent\n    settings:\n      agent: legacy\n`,
  );

  // Test presets: two first-party + one community-via-user-dir.
  await writePreset(firstPartyDir, "test-public.json", {
    id: "test-public", label: "Test Public",
    typeFamily: "openai-compatible-llm",
    defaultSettings: { baseUrl: "https://1.1.1.1/v1", model: "test-model" },
    trust: "first-party",
  });
  await writePreset(firstPartyDir, "test-ollama.json", {
    id: "test-ollama", label: "Test Ollama",
    typeFamily: "openai-compatible-llm",
    defaultSettings: { baseUrl: "http://localhost:11434/v1", model: "llama3" },
    allowLocalNetwork: true,
    trust: "first-party",
  });
  await writePreset(firstPartyDir, "test-cli-acp.json", {
    id: "test-cli-acp", label: "Test CLI ACP",
    typeFamily: "cli-acp-agent",
    defaultSettings: { agent: "nonexistent-agent" },
    trust: "first-party",
  });
  await writePreset(userPresetsDir, "user-thing.json", {
    id: "user-thing", label: "User Thing",
    typeFamily: "openai-compatible-llm",
    defaultSettings: { baseUrl: "https://1.1.1.1/v1", model: "x" },
    trust: "first-party",  // -> clamped to community
  });
});

afterEach(async () => {
  closeStateDbForTests();
  resetRunLedgerForTests();
  restoreEnv("AGENTIC_OS_CONFIG", originalConfig);
  restoreEnv("AGENTIC_OS_FIRST_PARTY_PRESETS_DIR", originalFirstParty);
  restoreEnv("AGENTIC_OS_PRESETS_DIR", originalUser);
  restoreEnv("AGENTIC_OS_AUDIT_DIR", originalAudit);
  restoreEnv("AGENTIC_OS_STATE_DB", originalStateDb);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}
async function writeYaml(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content, "utf8");
}
async function writePreset(dir: string, name: string, body: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(body), "utf8");
}
async function readConfigYaml(): Promise<string> {
  return fs.readFile(configPath, "utf8");
}
async function readAudit(): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const auditFile = path.join(auditDir, `${day}.jsonl`);
  if (!existsSync(auditFile)) return "";
  return fs.readFile(auditFile, "utf8");
}
function GET_REQ(url: string): Request {
  return new Request(url);
}
function POST_REQ(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : { body: "{}" }),
  });
}

// ── GET /api/connectors/presets ────────────────────────────────────────────
describe("GET /api/connectors/presets", () => {
  it("returns first-party presets and user presets with downward trust clamp", async () => {
    const res = await listPresets(GET_REQ(`${BASE}/presets`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId: Record<string, { trust: string }> = Object.fromEntries(
      body.presets.map((p: { id: string; trust: string }) => [p.id, p]),
    );
    expect(byId["test-public"]?.trust).toBe("first-party");
    expect(byId["test-ollama"]?.trust).toBe("first-party");
    // user-thing was declared "first-party" but loaded from the user dir
    // -> clamped to "community".
    expect(byId["user-thing"]?.trust).toBe("community");
  });
});

// ── GET /api/connectors ────────────────────────────────────────────────────
describe("GET /api/connectors", () => {
  it("lists configured connectors with UI-safe shape (no raw settings / authRef)", async () => {
    // The default config has the "preexisting" cli-acp instance.
    const res = await listConnectors(GET_REQ(BASE));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("legacy");           // settings.agent raw value
    expect(text).not.toContain("\"settings\"");      // no `settings` key in projection
    expect(text).not.toContain("\"authRef\":");      // no raw `authRef` field (authRefKind is the safe summary)
    expect(text).not.toContain("env:");              // no raw env var name leak
    const body = JSON.parse(text);
    const pre = body.connectors.find((c: { connectorId: string }) => c.connectorId === "preexisting");
    expect(pre).toMatchObject({
      typeFamily: "cli-acp-agent",
      enabled: false,
      authRefKind: "unset",
    });
  });
});

// ── POST /api/connectors ───────────────────────────────────────────────────
describe("POST /api/connectors", () => {
  it("adds an OpenAI-style connector with an env authRef", async () => {
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "openai-main",
      presetId: "test-public",
      authRef: "env:OPENAI_API_KEY",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connector).toMatchObject({
      connectorId: "openai-main",
      typeFamily: "openai-compatible-llm",
      presetId: "test-public",
      enabled: true,
      authRefKind: "env",
    });
    // The raw authRef value is NOT in the response.
    expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
  });

  it("adds an Ollama-style connector with no authRef; preset.allowLocalNetwork makes it effective", async () => {
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "ollama",
      presetId: "test-ollama",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connector.authRefKind).toBe("unset");
    expect(body.connector.allowLocalNetwork).toBe(true);
  });

  it("BLOCKS a private baseUrl override (127.0.0.1) when allowLocalNetwork is false; nothing is persisted", async () => {
    const before = await readConfigYaml();
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "lan-leak",
      presetId: "test-public",
      settings: { baseUrl: "http://127.0.0.1:11434/v1", model: "x" },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorClass).toBe("blocked-network");
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
    // Config unchanged.
    expect(await readConfigYaml()).toBe(before);
    // GET still doesn't include the rejected connector.
    const listed = await (await listConnectors(GET_REQ(BASE))).json();
    expect(listed.connectors.map((c: { connectorId: string }) => c.connectorId)).not.toContain("lan-leak");
  });

  it("BLOCKS the AWS metadata IP (169.254.169.254) and does not persist", async () => {
    const before = await readConfigYaml();
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "metadata",
      presetId: "test-public",
      settings: { baseUrl: "http://169.254.169.254/v1", model: "x" },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).errorClass).toBe("blocked-network");
    expect(await readConfigYaml()).toBe(before);
  });

  it("returns 409 duplicate-id when the connectorId already exists", async () => {
    const first = await addConnector(POST_REQ(BASE, {
      connectorId: "dup", presetId: "test-public", authRef: "env:K1",
    }));
    expect(first.status).toBe(200);
    const dup = await addConnector(POST_REQ(BASE, {
      connectorId: "dup", presetId: "test-public", authRef: "env:K2",
    }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).errorClass).toBe("duplicate-id");
  });

  it("rejects a raw API key in authRef neutrally; audits a failed add with no leak", async () => {
    const rawKey = "sk-ABCDEFG-do-not-leak";
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "leak-attempt",
      presetId: "test-public",
      authRef: rawKey,
    }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain(rawKey);
    expect(JSON.parse(text).errorClass).toBe("malformed-authRef");

    // Audit line — `connector.add` failed entry exists, no raw key leak.
    const audit = await readAudit();
    expect(audit).toContain("connector.add");
    expect(audit).toContain("malformed-authRef");
    expect(audit).not.toContain(rawKey);

    // Config unchanged.
    expect(await readConfigYaml()).not.toContain(rawKey);
  });

  it("rejects secret-looking keys in settings (body and merged)", async () => {
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "leak-settings",
      presetId: "test-public",
      settings: { apiKey: "sk-LEAK" },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorClass).toBe("secret-looking-key");
    expect(JSON.stringify(body)).not.toContain("sk-LEAK");
  });

  it("rejects an unknown presetId", async () => {
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "x", presetId: "no-such-preset",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).errorClass).toBe("preset-unknown");
  });

  it("preserves unrelated config and writes atomically (no temp artefacts)", async () => {
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "openai-main",
      presetId: "test-public",
      authRef: "env:OPENAI_KEY",
    }));
    expect(res.status).toBe(200);

    const yaml = await readConfigYaml();
    // Unrelated config preserved.
    expect(yaml).toContain(`root: ${vaultRoot}`);
    expect(yaml).toContain("enabled: true");          // features.scheduler.enabled
    expect(yaml).toContain("preexisting:");
    expect(yaml).toContain("openai-main:");
    // A backup of the prior config was taken.
    expect(existsSync(`${configPath}.bak`)).toBe(true);
    // No orphan temp artefacts.
    const siblings = await fs.readdir(path.dirname(configPath));
    expect(siblings.some((n) => n.includes(".tmp-"))).toBe(false);
  });
});

// ── POST /api/connectors — concurrency + env-override + failed-audit ──────
describe("POST /api/connectors — concurrency (TOCTOU race fix)", () => {
  it("two concurrent adds with DIFFERENT ids both persist", async () => {
    const [a, b] = await Promise.all([
      addConnector(POST_REQ(BASE, {
        connectorId: "race-a", presetId: "test-public", authRef: "env:KA",
      })),
      addConnector(POST_REQ(BASE, {
        connectorId: "race-b", presetId: "test-public", authRef: "env:KB",
      })),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const yaml = await readConfigYaml();
    expect(yaml).toContain("race-a:");
    expect(yaml).toContain("race-b:");
  });

  it("two concurrent adds with the SAME id produce one 200 and one 409", async () => {
    const [a, b] = await Promise.all([
      addConnector(POST_REQ(BASE, {
        connectorId: "race-dup", presetId: "test-public", authRef: "env:KA",
      })),
      addConnector(POST_REQ(BASE, {
        connectorId: "race-dup", presetId: "test-public", authRef: "env:KB",
      })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const yaml = await readConfigYaml();
    // The dup entry appears exactly ONCE.
    expect(yaml.match(/race-dup:/g)?.length).toBe(1);
  });
});

describe("POST /api/connectors — vault.root env override is NOT persisted (B2)", () => {
  it("a runtime AGENTIC_OS_VAULT does not leak into the written config", async () => {
    process.env.AGENTIC_OS_VAULT = "/tmp/agentic-os-fake-override-vault";
    try {
      const res = await addConnector(POST_REQ(BASE, {
        connectorId: "vault-test", presetId: "test-public", authRef: "env:K",
      }));
      expect(res.status).toBe(200);
      const yaml = await readConfigYaml();
      // The file still has the on-disk vault.root, not the runtime override.
      expect(yaml).toContain(`root: ${vaultRoot}`);
      expect(yaml).not.toContain("fake-override-vault");
    } finally {
      delete process.env.AGENTIC_OS_VAULT;
    }
  });
});

describe("POST /api/connectors — failed audits are neutral and leak-free", () => {
  it("audits a blocked-network failure with neutral fields only", async () => {
    const blockedUrl = "http://169.254.169.254/v1";
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "audit-block",
      presetId: "test-public",
      settings: { baseUrl: blockedUrl, model: "x" },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).errorClass).toBe("blocked-network");

    const audit = await readAudit();
    expect(audit).toContain("connector.add");
    expect(audit).toContain("audit-block");
    expect(audit).toContain("blocked-network");
    // No blocked URL/IP in the audit line.
    expect(audit).not.toContain("169.254.169.254");
    expect(audit).not.toContain(blockedUrl);
  });

  it("audits a secret-looking-key failure without leaking the value", async () => {
    const res = await addConnector(POST_REQ(BASE, {
      connectorId: "audit-leak",
      presetId: "test-public",
      settings: { apiKey: "sk-LEAK-DO-NOT-AUDIT" },
    }));
    expect(res.status).toBe(400);
    const audit = await readAudit();
    expect(audit).toContain("connector.add");
    expect(audit).toContain("secret-looking-key");
    expect(audit).not.toContain("sk-LEAK-DO-NOT-AUDIT");
  });
});

describe("POST /api/connectors — body size cap (64 KB)", () => {
  it("returns 413 invalid-body when Content-Length exceeds 64 KB; no config write", async () => {
    const before = await readConfigYaml();
    // The cap is on the DECLARED Content-Length header (per spec; a true
    // streaming byte-count cap is tracked separately). Set the header
    // explicitly above the cap; body content doesn't matter because the
    // cap short-circuits before req.json() runs.
    const res = await addConnector(
      new Request(BASE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "100000",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).errorClass).toBe("invalid-body");
    // No write happened — config bytes unchanged.
    expect(await readConfigYaml()).toBe(before);
  });
});

describe("GET /api/connectors/presets — helpUrl scheme guard", () => {
  it("skips a user preset whose helpUrl is a javascript: URL", async () => {
    await writePreset(userPresetsDir, "evil.json", {
      id: "evil",
      label: "Evil",
      typeFamily: "openai-compatible-llm",
      defaultSettings: { baseUrl: "https://1.1.1.1/v1", model: "m" },
      authPrompt: { apiKeyEnvVar: {
        label: "Key", helpUrl: "javascript:alert(1)",
      } },
      trust: "community",
    });
    const res = await listPresets(GET_REQ(`${BASE}/presets`));
    const body = await res.json();
    expect(body.presets.find((p: { id: string }) => p.id === "evil")).toBeUndefined();
  });

  it("accepts a user preset with a valid https:// helpUrl", async () => {
    await writePreset(userPresetsDir, "kind.json", {
      id: "kind",
      label: "Kind",
      typeFamily: "openai-compatible-llm",
      defaultSettings: { baseUrl: "https://1.1.1.1/v1", model: "m" },
      authPrompt: { apiKeyEnvVar: {
        label: "Key", helpUrl: "https://example.com/help",
      } },
      trust: "community",
    });
    const res = await listPresets(GET_REQ(`${BASE}/presets`));
    const body = await res.json();
    expect(body.presets.find((p: { id: string }) => p.id === "kind"))
      .toBeDefined();
  });
});

// ── POST /api/connectors/[id]/test ─────────────────────────────────────────
describe("POST /api/connectors/[id]/test", () => {
  it("creates a connector-test Run (no network call needed)", async () => {
    // Add a cli-acp-agent connector pointing at an unregistered agent —
    // family.testConnection -> agentRegistry.health -> "unknown agent" path,
    // so no network call is made, but a Run still gets created.
    const added = await addConnector(POST_REQ(BASE, {
      connectorId: "probe-cli", presetId: "test-cli-acp",
    }));
    expect(added.status).toBe(200);

    const res = await testConnector(
      POST_REQ(`${BASE}/probe-cli/test`),
      params("probe-cli"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.validation).toBeDefined();

    // Verify the run ledger picked up a connector-test row.
    const { getRunLedger } = await import("../src/kernel/state/runLedger");
    const ledger = await getRunLedger();
    const runs = ledger.listRuns({ kind: "connector-test" });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]!.connectorId).toBe("probe-cli");
  });

  it("returns 404 neutral for an unknown connector id", async () => {
    const res = await testConnector(POST_REQ(`${BASE}/ghost/test`), params("ghost"));
    expect(res.status).toBe(404);
    expect((await res.json()).errorClass).toBe("not-found");
  });
});

// ── CORS ───────────────────────────────────────────────────────────────────
describe("CORS / origin gate", () => {
  it("rejects a cross-site request to every /api/connectors route", async () => {
    const evil = { origin: "http://evil.example" };
    const a = await listConnectors(new Request(BASE, { headers: evil }));
    expect(a.status).toBe(403);
    const b = await listPresets(new Request(`${BASE}/presets`, { headers: evil }));
    expect(b.status).toBe(403);
    const c = await addConnector(new Request(BASE, {
      method: "POST", body: "{}", headers: { ...evil, "content-type": "application/json" },
    }));
    expect(c.status).toBe(403);
    const d = await testConnector(
      new Request(`${BASE}/preexisting/test`, { method: "POST", headers: evil }),
      params("preexisting"),
    );
    expect(d.status).toBe(403);
  });
});
