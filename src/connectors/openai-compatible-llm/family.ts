// openai-compatible-llm connector family (M4a — PR3a, spec §13).
//
// One ConnectorFamilyDefinition for any OpenAI-compatible HTTP endpoint —
// OpenAI itself, OpenRouter, a local Ollama, vLLM, etc. Operator instances
// pick a preset (e.g. "openai") + supply an env var name holding the API
// key (B3). The family exposes `chat.generate` against `<baseUrl>/chat/
// completions`.
//
// Security posture:
//   * `redirect: "manual"` — the family NEVER auto-follows a 3xx response.
//     A 3xx is a neutral failed result; the `Location` header is never read,
//     audited, logged, or surfaced (B11). DNS-rebinding angles are closed by
//     the SSRF guard (ssrf.ts) at config-add / testConnection time.
//   * Bearer auth header is added only when `ctx.secret` is present (a
//     local Ollama with no key still works without an authRef).
//   * Failed results stay neutral — the family never embeds raw response
//     bodies / status text / URL parts in the result; the router's B13
//     sanitization is the second line of defence.
//
// Note vs spec: `auth.required` is `false` so a no-auth Ollama preset
// works through buildConnectorContext; the family adds the Bearer header
// only when ctx.secret is present, and a 401 surfaces as `auth-failed`.

import { z } from "zod";
import type {
  ConnectorFamilyDefinition,
  ConnectorModelsResult,
  ConnectorResult,
  ConnectorValidation,
} from "@/kernel/connectors/types";
import { effectiveSignal } from "@/kernel/connectors/timeout";
import {
  CHAT_GENERATE_MAX_BYTES,
  LIST_MODELS_MAX_BYTES,
  TEST_CONNECTION_MAX_BYTES,
  readBoundedJson,
} from "@/kernel/connectors/bodyCap";

// Default per-operation timeouts (ms). Tight enough that a misbehaving
// provider cannot wedge a request indefinitely; loose enough that a healthy
// provider can answer.
const CHAT_GENERATE_TIMEOUT_MS = 60_000;
const TEST_CONNECTION_TIMEOUT_MS = 10_000;
const LIST_MODELS_TIMEOUT_MS = 15_000;

const settingsSchema = z
  .object({
    baseUrl: z.string().url(),
    model: z.string().min(1),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
  })
  .strict();
type Settings = z.infer<typeof settingsSchema>;

// Discovery surface — what `listModels` actually needs from the merged
// settings. NOT the full settingsSchema (which requires `model`). The
// registry's invariant check refuses a family declaring `listModels`
// without this schema.
const modelDiscoverySettingsSchema = z
  .object({
    baseUrl: z.string().url(),
  })
  .passthrough();

const chatGenerateInputSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string(),
        }),
      )
      .min(1),
  })
  .strict();

export interface OpenAiCompatibleLlmDeps {
  /** Inject `fetch` (test seam); production uses the global. */
  fetch?: typeof fetch;
}

export function createOpenAiCompatibleLlmFamily(
  deps: OpenAiCompatibleLlmDeps = {},
): ConnectorFamilyDefinition {
  const doFetch: typeof fetch = deps.fetch ?? fetch;

  function parseSettings(ctxSettings: unknown): Settings | null {
    const r = settingsSchema.safeParse(ctxSettings);
    return r.success ? r.data : null;
  }

  function chatCompletionsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  }
  function modelsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, "")}/models`;
  }

  return {
    id: "openai-compatible-llm",
    title: "OpenAI-Compatible LLM",
    kind: "ai-provider",
    transport: "http",
    capabilities: ["chat.generate"],
    sideEffects: ["external-api", "network"],
    defaultTrust: "first-party",
    settingsSchema,
    modelDiscoverySettingsSchema,
    defaultSettings: {},
    // Spec deviation: declared `false` so a no-auth Ollama preset works
    // through buildConnectorContext; the family adds the Bearer header only
    // when ctx.secret is present, and HTTP 401 -> errorCode "auth-failed".
    auth: { required: false, supportedRefs: ["env"] },

    async invoke(ctx, capability, input): Promise<ConnectorResult> {
      if (capability !== "chat.generate") {
        return { status: "failed", errorCode: "capability-not-supported" };
      }
      const settings = parseSettings(ctx.settings);
      if (!settings) return { status: "failed", errorCode: "config-invalid" };
      const parsedInput = chatGenerateInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return { status: "failed", errorCode: "config-invalid" };
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
      };
      if (ctx.secret) headers.authorization = `Bearer ${ctx.secret}`;

      const body = JSON.stringify({
        model: settings.model,
        messages: parsedInput.data.messages,
        ...(settings.maxTokens !== undefined
          ? { max_tokens: settings.maxTokens }
          : {}),
        ...(settings.temperature !== undefined
          ? { temperature: settings.temperature }
          : {}),
      });

      try {
        const res = await doFetch(chatCompletionsUrl(settings.baseUrl), {
          method: "POST",
          headers,
          body,
          redirect: "manual", // B11 — NEVER auto-follow a 3xx
          signal: effectiveSignal(ctx.signal, CHAT_GENERATE_TIMEOUT_MS),
        });

        // Status checks FIRST — body is only read on 2xx. response-too-large
        // applies ONLY to a 2xx whose body exceeded the cap.
        if (res.status >= 300 && res.status < 400) {
          // The redirected Location is NOT read; nothing about it crosses
          // into the result, audit, ledger, or log line (B11).
          console.error("[openai-compatible-llm] refusing to follow redirect");
          return { status: "failed", errorCode: "network-unreachable" };
        }
        if (res.status === 401 || res.status === 403) {
          return { status: "failed", errorCode: "auth-failed" };
        }
        if (res.status === 429) {
          return { status: "failed", errorCode: "rate-limited" };
        }
        if (!res.ok) {
          // Raw body is NOT read into the result — router B13 would drop it
          // anyway, but this path is the first line of defence.
          return { status: "failed", errorCode: "external-system-unavailable" };
        }

        const read = await readBoundedJson<{
          choices?: Array<{ message?: { content?: string } }>;
        }>(res, CHAT_GENERATE_MAX_BYTES);
        if (!read.ok) {
          if (read.reason === "too-large") {
            return { status: "failed", errorCode: "response-too-large" };
          }
          return { status: "failed", errorCode: "external-system-unavailable" };
        }
        const text = read.value.choices?.[0]?.message?.content ?? "";
        return { status: "success", output: { text } };
      } catch {
        console.error("[openai-compatible-llm] invoke threw");
        return { status: "failed", errorCode: "network-unreachable" };
      }
    },

    async testConnection(ctx): Promise<ConnectorValidation> {
      const startedAt = Date.now();
      const testedAt = new Date().toISOString();
      const settings = parseSettings(ctx.settings);
      if (!settings) {
        return {
          status: "misconfigured",
          errorCode: "config-invalid",
          testedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      const headers: Record<string, string> = { accept: "application/json" };
      if (ctx.secret) headers.authorization = `Bearer ${ctx.secret}`;

      try {
        const res = await doFetch(modelsUrl(settings.baseUrl), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: effectiveSignal(ctx.signal, TEST_CONNECTION_TIMEOUT_MS),
        });
        const durationMs = Date.now() - startedAt;
        if (res.status >= 300 && res.status < 400) {
          return {
            status: "unreachable",
            errorCode: "network-unreachable",
            testedAt,
            durationMs,
          };
        }
        if (res.status === 401 || res.status === 403) {
          return { status: "invalid", errorCode: "auth-failed", testedAt, durationMs };
        }
        if (res.status === 429) {
          return {
            status: "unreachable",
            errorCode: "rate-limited",
            testedAt,
            durationMs,
          };
        }
        if (!res.ok) {
          return {
            status: "unreachable",
            errorCode: "external-system-unavailable",
            testedAt,
            durationMs,
          };
        }
        // For testConnection we don't NEED the body, but we still drain it
        // through the bounded reader so we observe the over-cap path
        // symmetrically with chat.generate / listModels. Failure to read
        // the body is NOT a testConnection failure (the status code was
        // already 2xx) — we simply don't surface anything about it.
        await readBoundedJson(res, TEST_CONNECTION_MAX_BYTES).catch(() => null);
        return { status: "valid", testedAt, durationMs };
      } catch {
        return {
          status: "unreachable",
          errorCode: "network-unreachable",
          testedAt,
          durationMs: Date.now() - startedAt,
        };
      }
    },

    async listModels(ctx): Promise<ConnectorModelsResult> {
      // Validation surface for listModels is NARROW — `baseUrl` only.
      // `model` is intentionally absent (Load-models exists because the
      // operator may not know the model yet).
      const r = modelDiscoverySettingsSchema.safeParse(ctx.settings);
      if (!r.success) {
        return { ok: false, errorCode: "config-invalid" };
      }
      const baseUrl = r.data.baseUrl;

      const headers: Record<string, string> = { accept: "application/json" };
      if (ctx.secret) headers.authorization = `Bearer ${ctx.secret}`;

      try {
        const res = await doFetch(modelsUrl(baseUrl), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: effectiveSignal(ctx.signal, LIST_MODELS_TIMEOUT_MS),
        });

        // Status checks happen BEFORE body read. `response-too-large`
        // applies ONLY to a 2xx over-cap body — it is not a fall-through.
        if (res.status >= 300 && res.status < 400) {
          // B11 — Location is never read or surfaced.
          return { ok: false, errorCode: "network-unreachable" };
        }
        if (res.status === 401 || res.status === 403) {
          return { ok: false, errorCode: "auth-failed" };
        }
        if (res.status === 429) {
          return { ok: false, errorCode: "rate-limited" };
        }
        if (!res.ok) {
          return { ok: false, errorCode: "external-system-unavailable" };
        }

        const read = await readBoundedJson<{
          data?: Array<{ id?: unknown }>;
        }>(res, LIST_MODELS_MAX_BYTES);
        if (!read.ok) {
          if (read.reason === "too-large") {
            return { ok: false, errorCode: "response-too-large" };
          }
          return { ok: false, errorCode: "external-system-unavailable" };
        }
        const raw = read.value.data;
        if (!Array.isArray(raw)) {
          // Malformed shape — be neutral; this is NOT a network failure.
          return { ok: false, errorCode: "external-system-unavailable" };
        }
        const models = raw
          .map((m): { id?: unknown } | null =>
            m && typeof m === "object" ? (m as { id?: unknown }) : null,
          )
          .filter((m): m is { id?: unknown } => m !== null)
          .map((m) => (typeof m.id === "string" ? { id: m.id } : null))
          .filter((m): m is { id: string } => m !== null);
        return { ok: true, models };
      } catch {
        // Raw fetch error NEVER crosses into the result.
        return { ok: false, errorCode: "external-system-unavailable" };
      }
    },
  };
}

/** Production family, bound to the global fetch. */
export const openAiCompatibleLlmFamily: ConnectorFamilyDefinition =
  createOpenAiCompatibleLlmFamily();
