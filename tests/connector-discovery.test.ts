// runDiscoverModels + openai-compatible-llm.listModels tests (M4a-5 PR AB,
// spec §13).
//
// Two layers under test:
//   (1) openai-compatible-llm.listModels — the family unit. Fake fetch is
//       injected to exercise every status-code path + body-cap + malformed
//       JSON + projection.
//   (2) runDiscoverModels — the kernel orchestration. Fake registry / preset
//       set / family.listModels lets us assert the pipeline (secret-key
//       screen, preset lookup, settings-invalid, blocked-network, audit).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { createOpenAiCompatibleLlmFamily } from "../src/connectors/openai-compatible-llm";
import { runDiscoverModels } from "../src/kernel/connectors/discovery";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import type {
  ConnectorFamilyDefinition,
  ConnectorInvokeContext,
  ConnectorModelsResult,
  ConnectorResult,
} from "../src/kernel/connectors/types";
import { LIST_MODELS_MAX_BYTES } from "../src/kernel/connectors/bodyCap";

// ── openai-compatible-llm.listModels ────────────────────────────────────────

function ctxFor(baseUrl: string, secret?: string): ConnectorInvokeContext {
  return {
    connectorId: "preview:test",
    typeFamily: "openai-compatible-llm",
    settings: { baseUrl } as Record<string, unknown>,
    ...(secret ? { secret } : {}),
  };
}

function fullCtxFor(baseUrl: string, model: string, secret?: string): ConnectorInvokeContext {
  // testConnection requires the FULL settings (baseUrl + model). listModels
  // requires only baseUrl. This helper builds the testConnection-shaped ctx.
  return {
    connectorId: "test:test",
    typeFamily: "openai-compatible-llm",
    settings: { baseUrl, model } as Record<string, unknown>,
    ...(secret ? { secret } : {}),
  };
}

describe("openai-compatible-llm.listModels", () => {
  it("validates ONLY baseUrl — `model` is NOT required", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async (url, init) => {
        captured = { url: String(url), init };
        return new Response(JSON.stringify({ data: [{ id: "x" }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    });
    const r = await family.listModels!(ctxFor("https://provider.test/v1"));
    expect(r).toEqual({ ok: true, models: [{ id: "x" }] });
    // `model` was absent from settings — listModels did NOT fail on that.
    expect(captured!.url).toBe("https://provider.test/v1/models");
  });

  it("projects { data: [{ id }] } to ConnectorModelEntry[]", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async () => new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4o", object: "model" },
            { id: "gpt-4o-mini", flags: ["chat"] },
            { id: 42 },        // malformed -> dropped
            "not-an-object",   // malformed -> dropped
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });
    const r = await family.listModels!(ctxFor("https://x/v1"));
    expect(r).toEqual({ ok: true, models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
  });

  it("status code mapping happens BEFORE body read", async () => {
    const cases: Array<{ status: number; code: string }> = [
      { status: 302, code: "network-unreachable" },
      { status: 401, code: "auth-failed" },
      { status: 403, code: "auth-failed" },
      { status: 429, code: "rate-limited" },
      { status: 500, code: "external-system-unavailable" },
    ];
    for (const { status, code } of cases) {
      const family = createOpenAiCompatibleLlmFamily({
        fetch: async () => new Response("ignored", { status }),
      });
      const r = await family.listModels!(ctxFor("https://x/v1"));
      expect(r).toEqual({ ok: false, errorCode: code });
    }
  });

  it("returns response-too-large when a 2xx body exceeds the cap", async () => {
    // Build a body larger than LIST_MODELS_MAX_BYTES (2 MB). We don't need
    // valid JSON — the size check fires first.
    const body = "x".repeat(LIST_MODELS_MAX_BYTES + 1024);
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async () => new Response(body, { status: 200 }),
    });
    const r = await family.listModels!(ctxFor("https://x/v1"));
    expect(r).toEqual({ ok: false, errorCode: "response-too-large" });
  });

  it("returns external-system-unavailable when a 2xx body is malformed JSON", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async () => new Response("<<<garbage>>>", { status: 200 }),
    });
    const r = await family.listModels!(ctxFor("https://x/v1"));
    expect(r).toEqual({ ok: false, errorCode: "external-system-unavailable" });
  });

  it("never lets a thrown fetch leak — returns external-system-unavailable", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async () => { throw new Error("never crosses"); },
    });
    const r = await family.listModels!(ctxFor("https://x/v1"));
    expect(r).toEqual({ ok: false, errorCode: "external-system-unavailable" });
  });

  it("testConnection on a 2xx over-cap body returns unreachable with response-too-large, NOT valid", async () => {
    // Regression guard: an over-cap testConnection body MUST fail neutrally
    // rather than slip through as `valid`. Symmetric with chat.generate +
    // listModels.
    const body = "x".repeat(512 * 1024); // 512 KB > 256 KB testConnection cap
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async () => new Response(body, { status: 200 }),
    });
    const v = await family.testConnection!(fullCtxFor("https://x/v1", "m"));
    expect(v.status).toBe("unreachable");
    expect(v.errorCode).toBe("response-too-large");
  });

  it("testConnection on a 2xx invalid-JSON body STILL returns valid (status code is enough)", async () => {
    // testConnection only needs the status code to declare validity — a
    // non-JSON but 2xx response from a misconfigured proxy is still
    // evidence the endpoint is reachable. Only `too-large` is fatal.
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async () => new Response("<<<not-json>>>", { status: 200 }),
    });
    const v = await family.testConnection!(fullCtxFor("https://x/v1", "m"));
    expect(v.status).toBe("valid");
  });

  it("sends Authorization: Bearer only when ctx.secret is present", async () => {
    let lastInit: RequestInit | undefined;
    const family = createOpenAiCompatibleLlmFamily({
      fetch: async (_url, init) => {
        lastInit = init;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    // No secret -> no Authorization header.
    await family.listModels!(ctxFor("https://x/v1"));
    const headers1 = (lastInit?.headers ?? {}) as Record<string, string>;
    expect(headers1.authorization).toBeUndefined();
    // With secret -> Authorization is present.
    await family.listModels!(ctxFor("https://x/v1", "sk-redacted-marker-XYZ"));
    const headers2 = (lastInit?.headers ?? {}) as Record<string, string>;
    expect(headers2.authorization).toBe("Bearer sk-redacted-marker-XYZ");
  });
});

// ── runDiscoverModels (orchestration) ───────────────────────────────────────

function fakeOpenAiCompatibleFamily(opts: {
  listModelsImpl?: (ctx: ConnectorInvokeContext) => Promise<ConnectorModelsResult>;
} = {}): ConnectorFamilyDefinition {
  return {
    id: "openai-compatible-llm",
    title: "Fake",
    kind: "ai-provider",
    transport: "http",
    capabilities: ["chat.generate"],
    sideEffects: ["external-api", "network"],
    defaultTrust: "first-party",
    settingsSchema: z.object({ baseUrl: z.string().url(), model: z.string().min(1) }).strict(),
    modelDiscoverySettingsSchema: z.object({ baseUrl: z.string().url() }).passthrough(),
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },
    async invoke(): Promise<ConnectorResult> {
      return { status: "failed", errorCode: "capability-not-supported" };
    },
    listModels: opts.listModelsImpl ?? (async () => ({
      ok: true,
      models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
    })),
  };
}

function fakeCliAcpFamily(): ConnectorFamilyDefinition {
  return {
    id: "cli-acp-agent",
    title: "Fake CLI",
    kind: "managed-agent",
    transport: "subprocess",
    capabilities: ["agent.run"],
    sideEffects: ["local-process"],
    defaultTrust: "first-party",
    settingsSchema: z.object({ agent: z.string().min(1) }).strict(),
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },
    async invoke(): Promise<ConnectorResult> {
      return { status: "success", output: {} };
    },
    // No listModels declared — discovery should return capability-not-supported.
  };
}

// Use a temp audit dir so deterministic-await assertions can read JSONL back.
let tmpDir: string;
let auditDir: string;
let originalAudit: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "connector-discovery-"));
  auditDir = path.join(tmpDir, "audit");
  await fs.mkdir(auditDir, { recursive: true });
  originalAudit = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;
});

afterEach(async () => {
  if (originalAudit === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAudit;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function readAudit(): Promise<string[]> {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `${day}.jsonl`);
  if (!existsSync(file)) return [];
  const text = await fs.readFile(file, "utf8");
  return text.split("\n").filter(Boolean);
}

describe("runDiscoverModels", () => {
  it("returns models on the happy path and audits success with modelCount", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily());
    const r = await runDiscoverModels(
      { presetId: "test-public", settings: { baseUrl: "https://1.1.1.1/v1" } },
      {
        registry: reg,
        presets: [
          {
            id: "test-public",
            label: "Test Public",
            typeFamily: "openai-compatible-llm",
            defaultSettings: { baseUrl: "https://1.1.1.1/v1" },
            trust: "first-party",
          },
        ],
      },
    );
    expect(r).toEqual({ ok: true, models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
    const lines = await readAudit();
    expect(lines.length).toBe(1);
    const audit = JSON.parse(lines[0]!);
    expect(audit.kind).toBe("connector.models.discover");
    expect(audit.presetId).toBe("test-public");
    expect(audit.status).toBe("success");
    expect(audit.modelCount).toBe(2);
    // NO connectorId on a pre-save discovery line.
    expect(audit.connectorId).toBeUndefined();
  });

  it("returns preset-unknown when the preset does not exist", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily());
    const r = await runDiscoverModels(
      { presetId: "no-such-preset" },
      { registry: reg, presets: [] },
    );
    expect(r).toEqual({ ok: false, errorCode: "preset-unknown" });
    const audit = JSON.parse((await readAudit())[0]!);
    expect(audit.status).toBe("failed");
    expect(audit.errorCode).toBe("preset-unknown");
  });

  it("returns capability-not-supported for a family without listModels", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeCliAcpFamily());
    const r = await runDiscoverModels(
      { presetId: "cli-only" },
      {
        registry: reg,
        presets: [
          {
            id: "cli-only",
            label: "CLI Only",
            typeFamily: "cli-acp-agent",
            defaultSettings: { agent: "test-agent" },
            trust: "first-party",
          },
        ],
      },
    );
    expect(r).toEqual({ ok: false, errorCode: "capability-not-supported" });
  });

  it("returns secret-looking-key when body.settings carries a secret-looking key", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily());
    const r = await runDiscoverModels(
      {
        presetId: "test-public",
        settings: { baseUrl: "https://1.1.1.1/v1", apiKey: "sk-leaked" },
      },
      {
        registry: reg,
        presets: [{
          id: "test-public",
          label: "Test",
          typeFamily: "openai-compatible-llm",
          defaultSettings: { baseUrl: "https://1.1.1.1/v1" },
          trust: "first-party",
        }],
      },
    );
    expect(r).toEqual({ ok: false, errorCode: "secret-looking-key" });
    // Audit must NOT include the leaked value.
    const text = (await readAudit()).join("\n");
    expect(text).not.toContain("sk-leaked");
  });

  it("returns blocked-network for an HTTP family pointing at a private address", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily());
    const r = await runDiscoverModels(
      { presetId: "test-public", settings: { baseUrl: "https://127.0.0.1/v1" } },
      {
        registry: reg,
        presets: [{
          id: "test-public",
          label: "Test",
          typeFamily: "openai-compatible-llm",
          defaultSettings: { baseUrl: "https://127.0.0.1/v1" },
          trust: "first-party",
        }],
      },
    );
    expect(r).toEqual({ ok: false, errorCode: "blocked-network" });
  });

  it("returns settings-invalid when modelDiscoverySettingsSchema rejects the merged settings", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily());
    const r = await runDiscoverModels(
      // baseUrl missing entirely — discovery schema requires it.
      { presetId: "no-defaults" },
      {
        registry: reg,
        presets: [{
          id: "no-defaults",
          label: "No defaults",
          typeFamily: "openai-compatible-llm",
          defaultSettings: {},
          trust: "first-party",
        }],
      },
    );
    expect(r).toEqual({ ok: false, errorCode: "settings-invalid" });
  });

  it("returns auth-missing when authRef points at an env var that is empty", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily());
    delete process.env.M4A5_AB_NONEXISTENT;
    const r = await runDiscoverModels(
      {
        presetId: "p", authRef: "env:M4A5_AB_NONEXISTENT",
        settings: { baseUrl: "https://1.1.1.1/v1" },
      },
      {
        registry: reg,
        presets: [{
          id: "p", label: "P", typeFamily: "openai-compatible-llm",
          defaultSettings: { baseUrl: "https://1.1.1.1/v1" }, trust: "first-party",
        }],
      },
    );
    expect(r).toEqual({ ok: false, errorCode: "auth-missing" });
  });

  it("projects family.listModels failure errorCodes into the discovery allowlist", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeOpenAiCompatibleFamily({
      listModelsImpl: async () => ({ ok: false, errorCode: "rate-limited" }),
    }));
    const r = await runDiscoverModels(
      { presetId: "p", settings: { baseUrl: "https://1.1.1.1/v1" } },
      {
        registry: reg,
        presets: [{
          id: "p", label: "P", typeFamily: "openai-compatible-llm",
          defaultSettings: { baseUrl: "https://1.1.1.1/v1" }, trust: "first-party",
        }],
      },
    );
    expect(r).toEqual({ ok: false, errorCode: "rate-limited" });
  });

  it("never echoes the env var name or resolved secret on any path", async () => {
    const reg = registryTest.newRegistry();
    // Make the family call surface auth-failed (simulating a real 401).
    reg.register(fakeOpenAiCompatibleFamily({
      listModelsImpl: async () => ({ ok: false, errorCode: "auth-failed" }),
    }));
    process.env.M4A5_AB_LEAK_PROBE = "sk-test-redacted-marker-XYZ";
    try {
      const r = await runDiscoverModels(
        {
          presetId: "p",
          authRef: "env:M4A5_AB_LEAK_PROBE",
          settings: { baseUrl: "https://1.1.1.1/v1" },
        },
        {
          registry: reg,
          presets: [{
            id: "p", label: "P", typeFamily: "openai-compatible-llm",
            defaultSettings: { baseUrl: "https://1.1.1.1/v1" }, trust: "first-party",
          }],
        },
      );
      // Response carries the projected errorCode but no secret material.
      const serialised = JSON.stringify(r);
      expect(serialised).not.toContain("M4A5_AB_LEAK_PROBE");
      expect(serialised).not.toContain("sk-test-redacted-marker-XYZ");
      // Audit ditto.
      const text = (await readAudit()).join("\n");
      expect(text).not.toContain("M4A5_AB_LEAK_PROBE");
      expect(text).not.toContain("sk-test-redacted-marker-XYZ");
    } finally {
      delete process.env.M4A5_AB_LEAK_PROBE;
    }
  });
});
