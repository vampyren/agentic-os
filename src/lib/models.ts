// Per-model context-window sizes. Used by the AgentRoom tokens card to
// render a "used / max" fill bar.
//
// Lookup is fuzzy: exact match first, then prefix match against the model
// family. Lets `claude-opus-4-7[1m]` resolve via the `[1m]` suffix, and
// future Sonnet/Haiku variants resolve via family prefix without an exact
// match in the table.
//
// When in doubt we default to 200000 (Claude family standard), which
// underestimates the bar fraction rather than overestimating it.

interface ModelInfo {
  contextTokens: number;
  family?: string;
}

// Exact-match table. Add entries as new models ship.
const EXACT: Record<string, ModelInfo> = {
  // Claude family — the [1m] suffix in the model string is Anthropic's
  // marker for the 1M-context variants.
  "claude-opus-4-7":     { contextTokens: 200_000,  family: "claude" },
  "claude-sonnet-4-6":   { contextTokens: 200_000,  family: "claude" },
  "claude-haiku-4-5":    { contextTokens: 200_000,  family: "claude" },

  // OpenAI (placeholder for v0.4.0 http transport; matches what Hermes
  // shows in its TUI per the operator's screenshot).
  "gpt-5.5":             { contextTokens: 272_000,  family: "openai" },
  "gpt-5.5-pro":         { contextTokens: 272_000,  family: "openai" },
  "gpt-4.1-mini":        { contextTokens: 128_000,  family: "openai" },

  // Google
  "gemini-2.5-pro":      { contextTokens: 1_000_000, family: "google" },
  "gemma-4-26b-a4b":     { contextTokens: 128_000,  family: "google" },

  // Other local / OSS commonly used in the operator's setup
  "qwen3.6-35b-a3b":     { contextTokens: 32_000,   family: "qwen" },
  "qwen3-coder:30b":     { contextTokens: 32_000,   family: "qwen" },
  "gemma3:12b-it-qat":   { contextTokens: 128_000,  family: "google" },
};

// Family-prefix fallbacks for when the exact model string doesn't match
// but we can recognise the family. Ordered most-specific first.
const FAMILY_FALLBACKS: Array<{ prefix: string; info: ModelInfo }> = [
  { prefix: "claude-opus",   info: { contextTokens: 200_000, family: "claude" } },
  { prefix: "claude-sonnet", info: { contextTokens: 200_000, family: "claude" } },
  { prefix: "claude-haiku",  info: { contextTokens: 200_000, family: "claude" } },
  { prefix: "claude-",       info: { contextTokens: 200_000, family: "claude" } },
  { prefix: "gpt-5",         info: { contextTokens: 272_000, family: "openai" } },
  { prefix: "gpt-4",         info: { contextTokens: 128_000, family: "openai" } },
  { prefix: "gemini",        info: { contextTokens: 1_000_000, family: "google" } },
  { prefix: "gemma",         info: { contextTokens: 128_000, family: "google" } },
  { prefix: "qwen",          info: { contextTokens: 32_000,  family: "qwen" } },
  { prefix: "llama",         info: { contextTokens: 128_000, family: "meta" } },
];

const DEFAULT_CONTEXT = 200_000;

/**
 * Resolve a model string to its context-window size (in tokens) and family.
 * Handles:
 *   - Provider-prefixed IDs: "openai/gpt-5.5", "anthropic/claude-opus-4-7" —
 *     the prefix before the first `/` is stripped before lookup.
 *   - Anthropic-style annotations: "claude-opus-4-7[1m]" — overrides the
 *     base model's default with the annotated context.
 *
 * Hermes / OpenRouter / Ollama all use provider-prefixed strings, so this
 * normalization matters for the Hermes usage card and Phase 2A's http
 * transport.
 */
export function resolveModel(modelString: string): ModelInfo {
  if (!modelString) return { contextTokens: DEFAULT_CONTEXT };

  // Strip provider prefix if present (e.g. "openai/gpt-5.5" → "gpt-5.5").
  // We only strip a single segment — model IDs themselves don't contain '/'.
  const normalized = modelString.includes("/")
    ? modelString.split("/").slice(1).join("/")
    : modelString;

  // Anthropic's [1m] / [200k] / etc. annotation overrides whatever the base
  // model would have been. Example: "claude-opus-4-7[1m]".
  const annotation = normalized.match(/\[(\d+)([km])\]/i);
  if (annotation) {
    const num = Number(annotation[1]);
    const unit = (annotation[2] ?? "").toLowerCase();
    const multiplier = unit === "m" ? 1_000_000 : 1_000;
    const base = stripAnnotation(normalized);
    const baseInfo = lookupBase(base);
    return { contextTokens: num * multiplier, family: baseInfo.family };
  }

  return lookupBase(normalized);
}

function stripAnnotation(s: string): string {
  return s.replace(/\[[^\]]+\]/g, "").trim();
}

function lookupBase(model: string): ModelInfo {
  if (EXACT[model]) return EXACT[model]!;
  for (const f of FAMILY_FALLBACKS) {
    if (model.startsWith(f.prefix)) return f.info;
  }
  return { contextTokens: DEFAULT_CONTEXT };
}

/**
 * Compute the total tokens consumed in a single turn — for the context
 * fill bar we treat input + cache (read + creation) as the "context" portion
 * and output as the "generated" portion. Some accounting wiggle room here,
 * but for a visual fill bar the operator gets what they need.
 */
export interface ContextBreakdown {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  usedTotal: number;          // sum of all four
  contextTotal: number;       // input + cache read + cache creation (no output)
}

export function contextBreakdown(input: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): ContextBreakdown {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cacheReadTokens = input.cacheReadInputTokens ?? 0;
  const cacheCreationTokens = input.cacheCreationInputTokens ?? 0;
  const contextTotal = inputTokens + cacheReadTokens + cacheCreationTokens;
  const usedTotal = contextTotal + outputTokens;
  return {
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    outputTokens,
    contextTotal,
    usedTotal,
  };
}
