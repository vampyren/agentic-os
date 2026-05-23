// POST /api/connectors/models/preview — route tests (M4a-5 PR AB, spec §13).
//
// Mirrors the api-connectors.test.ts setup: tmp config + first-party + user
// preset dirs, tmp audit dir. No DNS — every test uses IP-literal baseUrls.
// The openai-compatible-llm family's fetch is NOT injected here; tests use a
// FAKE family registered on a tmp registry where possible. Where the real
// registered family is exercised (e.g. CORS + content-length checks), we
// rely on the route's secret-key + body validation + SSRF guard to short-
// circuit BEFORE any HTTP call.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { POST } from "../src/app/api/connectors/models/preview/route";

const BASE = "http://127.0.0.1:3000/api/connectors/models/preview";

let tmpDir: string;
let firstPartyDir: string;
let userPresetsDir: string;
let auditDir: string;

let originalFirstParty: string | undefined;
let originalUser: string | undefined;
let originalAudit: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-models-preview-"));
  firstPartyDir = path.join(tmpDir, "presets-first");
  userPresetsDir = path.join(tmpDir, "presets-user");
  auditDir = path.join(tmpDir, "audit");
  await fs.mkdir(firstPartyDir, { recursive: true });
  await fs.mkdir(userPresetsDir, { recursive: true });
  await fs.mkdir(auditDir, { recursive: true });

  originalFirstParty = process.env.AGENTIC_OS_FIRST_PARTY_PRESETS_DIR;
  originalUser = process.env.AGENTIC_OS_PRESETS_DIR;
  originalAudit = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_FIRST_PARTY_PRESETS_DIR = firstPartyDir;
  process.env.AGENTIC_OS_PRESETS_DIR = userPresetsDir;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;

  // A small first-party catalog for these tests. Public IP-literal baseUrls
  // so no SSRF guard fires unless the test wants it to.
  await writePreset(firstPartyDir, "test-public.json", {
    id: "test-public", label: "Test Public",
    typeFamily: "openai-compatible-llm",
    defaultSettings: { baseUrl: "https://1.1.1.1/v1", model: "test-model" },
    trust: "first-party",
  });
  await writePreset(firstPartyDir, "test-private.json", {
    id: "test-private", label: "Test Private",
    typeFamily: "openai-compatible-llm",
    defaultSettings: { baseUrl: "https://127.0.0.1/v1", model: "x" },
    trust: "first-party",
  });
  await writePreset(firstPartyDir, "test-cli-acp.json", {
    id: "test-cli-acp", label: "Test CLI ACP",
    typeFamily: "cli-acp-agent",
    defaultSettings: { agent: "test-agent" },
    trust: "first-party",
  });
});

afterEach(async () => {
  restoreEnv("AGENTIC_OS_FIRST_PARTY_PRESETS_DIR", originalFirstParty);
  restoreEnv("AGENTIC_OS_PRESETS_DIR", originalUser);
  restoreEnv("AGENTIC_OS_AUDIT_DIR", originalAudit);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}
async function writePreset(dir: string, name: string, body: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(body), "utf8");
}
async function readAudit(): Promise<string[]> {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `${day}.jsonl`);
  if (!existsSync(file)) return [];
  const text = await fs.readFile(file, "utf8");
  return text.split("\n").filter(Boolean);
}
function POST_REQ(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : { body: "{}" }),
  });
}

describe("POST /api/connectors/models/preview — input validation", () => {
  it("rejects non-JSON bodies with 400 invalid-json", async () => {
    const r = await POST(new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
      body: "<<not-json>>",
    }));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.errorClass).toBe("invalid-json");
  });

  it("rejects an over-cap content-length with 413", async () => {
    const r = await POST(POST_REQ({ presetId: "test-public" }, {
      "content-length": String(100_000),
    }));
    expect(r.status).toBe(413);
    const body = await r.json();
    expect(body.errorClass).toBe("invalid-body");
  });

  it("rejects malformed authRef without echoing the value (404+ wait, neutral)", async () => {
    const r = await POST(POST_REQ({
      presetId: "test-public",
      authRef: "sk-leaked-XYZ",      // not env:NAME and not none
    }));
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).toContain("malformed-authRef");
    // The raw value MUST NOT crossed back in the response body, the audit, or
    // anywhere else.
    expect(text).not.toContain("sk-leaked-XYZ");
    const auditText = (await readAudit()).join("\n");
    expect(auditText).toContain("malformed-authRef");
    expect(auditText).not.toContain("sk-leaked-XYZ");
  });

  it("rejects body.settings carrying a secret-looking key, NEVER echoes value", async () => {
    const r = await POST(POST_REQ({
      presetId: "test-public",
      settings: { apiKey: "sk-leaked-XYZ", model: "x" },
    }));
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).toContain("secret-looking-key");
    expect(text).not.toContain("sk-leaked-XYZ");
  });

  it("rejects unknown body fields with invalid-body", async () => {
    const r = await POST(POST_REQ({
      presetId: "test-public",
      whatever: 1,
    }));
    expect(r.status).toBe(400);
    expect((await r.json()).errorClass).toBe("invalid-body");
  });
});

describe("POST /api/connectors/models/preview — orchestration", () => {
  it("returns preset-unknown when the preset id is not in the catalog", async () => {
    const r = await POST(POST_REQ({ presetId: "no-such-preset" }));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.errorClass).toBe("preset-unknown");
  });

  it("returns capability-not-supported for a family without listModels (cli-acp-agent)", async () => {
    const r = await POST(POST_REQ({ presetId: "test-cli-acp" }));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.errorClass).toBe("capability-not-supported");
    const audit = JSON.parse((await readAudit()).slice(-1)[0]!);
    expect(audit.kind).toBe("connector.models.discover");
    expect(audit.presetId).toBe("test-cli-acp");
    expect(audit.status).toBe("failed");
    expect(audit.errorCode).toBe("capability-not-supported");
    expect(audit.connectorId).toBeUndefined();
  });

  it("returns blocked-network for an HTTP preset pointing at a private address (no allowLocalNetwork)", async () => {
    const r = await POST(POST_REQ({ presetId: "test-private" }));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.errorClass).toBe("blocked-network");
    const audit = JSON.parse((await readAudit()).slice(-1)[0]!);
    expect(audit.errorCode).toBe("blocked-network");
  });

  it("audits a failed attempt deterministically (audit line present at response time)", async () => {
    const before = await readAudit();
    const r = await POST(POST_REQ({ presetId: "test-cli-acp" }));
    expect(r.status).toBe(400);
    // Audit line must be on disk BEFORE the response resolves — symmetric
    // with POST /api/connectors's awaited audit.
    const after = await readAudit();
    expect(after.length).toBe(before.length + 1);
  });
});

describe("POST /api/connectors/models/preview — CORS", () => {
  it("rejects a cross-site origin with 403", async () => {
    const req = new Request(BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
      },
      body: JSON.stringify({ presetId: "test-public" }),
    });
    const r = await POST(req);
    expect(r.status).toBe(403);
  });
});
