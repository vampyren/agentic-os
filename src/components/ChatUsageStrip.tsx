"use client";

// Slim usage strip rendered below the chat composer when the transport
// has reported at least one usage event for the session. Two rows:
//
//   Row 1: model name · context-fill bar · "used / max · XX%"
//          This is the headline. The bar visualises how full the
//          model's context window currently is (last turn's input +
//          cache reads + cache creation, against the model's documented
//          context window from src/lib/models.ts). Color shifts at 80%
//          (amber) and 95% (red), matching the Hermes memory bars
//          treatment for visual consistency across the app.
//
//   Row 2: session turns · last in/out · total in/out · cost
//          The condensed accounting line — what the previous slim
//          strip used to surface, just compacted and made consistent
//          with the new uppercase-K token format.
//
// Hover the bar for a precise "N / max tokens · XX.X%" tooltip.
//
// Renders nothing when the model is unknown AND no turn has completed.
// This preserves the Slice 4 e2e contract (the strip is absent on a
// fresh chat with no usage reported yet).

import { resolveModel, contextBreakdown } from "@/lib/models";

interface AgentUsageShape {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
}

interface SessionTotals {
  turns: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}

interface Props {
  accent: string;
  lastUsage: AgentUsageShape | null;
  sessionUsage: SessionTotals;
}

export default function ChatUsageStrip({ accent, lastUsage, sessionUsage }: Props) {
  const model = lastUsage?.model;
  const breakdown = contextBreakdown({
    inputTokens: lastUsage?.inputTokens,
    outputTokens: lastUsage?.outputTokens,
    cacheReadInputTokens: lastUsage?.cacheReadInputTokens,
    cacheCreationInputTokens: lastUsage?.cacheCreationInputTokens,
  });
  const resolved = model ? resolveModel(model) : null;
  const max = resolved?.contextTokens ?? 0;
  const used = breakdown.contextTotal;
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

  // Subtle severity shift mirrors HermesMemoryBars: accent up to 80%,
  // amber at 80–95%, red above 95%.
  const barColor =
    pct >= 95
      ? "var(--status-offline, #f87171)"
      : pct >= 80
        ? "var(--status-degraded, #fbbf24)"
        : accent;

  const tooltip =
    max > 0
      ? `${used.toLocaleString()} / ${max.toLocaleString()} tokens · ${pct.toFixed(1)}%`
      : "Context window unknown for this model";

  const hasLast = Boolean(
    lastUsage && ((lastUsage.inputTokens ?? 0) > 0 || (lastUsage.outputTokens ?? 0) > 0),
  );
  const hasAnyTurns = sessionUsage.turns > 0;
  const hasSessionTotals =
    (sessionUsage.inputTokens ?? 0) > 0 || (sessionUsage.outputTokens ?? 0) > 0;
  const hasCost = (sessionUsage.totalCostUsd ?? 0) > 0;

  // Preserve the Slice 4 contract: don't render at all on a fresh chat
  // with no usage reported yet. The e2e test pins this. Once a model
  // identity has been established (either via a real turn or via the
  // model that newSession() preserves through the reset), the strip
  // stays visible.
  if (!model && !hasLast && !hasAnyTurns) return null;

  return (
    <div
      data-testid="chat-usage-strip"
      className="border-t border-[var(--border)] px-5 py-2.5 space-y-1.5 text-[11px] font-mono"
    >
      {/* Row 1 — model + context-fill bar + tokens + %% */}
      <div className="flex items-center gap-3" title={tooltip}>
        {model && (
          <span className="text-[var(--fg-dim)] shrink-0 tracking-tight">{model}</span>
        )}
        {max > 0 ? (
          // Bar always renders when the model's context size is known
          // — even at 0% (empty bar after a New Session click, when the
          // model identity is preserved but token counts are reset).
          // That gives the operator a visible "reset" state instead of
          // the whole strip disappearing until the next response.
          <>
            <div className="flex-1 h-1.5 rounded-full bg-[color:var(--border)] overflow-hidden min-w-[80px] max-w-[420px]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
            <span className="tabular-nums text-[var(--fg)] shrink-0">
              {formatTokens(used)} / {formatTokens(max)}
            </span>
            <span className="tabular-nums text-[var(--fg-dimmer)] w-10 text-right shrink-0">
              {Math.round(pct)}%
            </span>
          </>
        ) : (
          <span className="text-[var(--fg-dimmer)]">context window unknown</span>
        )}
      </div>

      {/* Row 2 — condensed accounting. The `session N turns` counter
          always renders whenever the strip itself is visible (so the
          reset state shows "session 0 turns" instead of collapsing to
          a one-row strip and shifting the layout). `last`, `total`,
          and `$cost` stay conditional — "last 0 in / 0 out" would
          misleadingly imply there was a zero-token last turn vs. no
          last turn at all. */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[var(--fg-dimmer)]">
        <span>
          session{" "}
          <span className="text-[var(--fg-dim)]">
            {sessionUsage.turns} {sessionUsage.turns === 1 ? "turn" : "turns"}
          </span>
        </span>
        {hasLast && (
          <>
            <span className="opacity-50">·</span>
            <span>
              last{" "}
              <span className="text-[var(--fg-dim)]">
                {(lastUsage?.inputTokens ?? 0) > 0 && `${formatTokens(lastUsage!.inputTokens!)} in`}
                {(lastUsage?.inputTokens ?? 0) > 0 && (lastUsage?.outputTokens ?? 0) > 0 && " / "}
                {(lastUsage?.outputTokens ?? 0) > 0 && `${formatTokens(lastUsage!.outputTokens!)} out`}
              </span>
            </span>
          </>
        )}
        {hasSessionTotals && (
          <>
            <span className="opacity-50">·</span>
            <span>
              total{" "}
              <span className="text-[var(--fg-dim)]">
                {(sessionUsage.inputTokens ?? 0) > 0 && `${formatTokens(sessionUsage.inputTokens!)} in`}
                {(sessionUsage.inputTokens ?? 0) > 0 && (sessionUsage.outputTokens ?? 0) > 0 && " / "}
                {(sessionUsage.outputTokens ?? 0) > 0 && `${formatTokens(sessionUsage.outputTokens!)} out`}
              </span>
            </span>
          </>
        )}
        {hasCost && (
          <>
            <span className="opacity-50">·</span>
            <span className="text-[var(--fg-dim)]">
              ${sessionUsage.totalCostUsd!.toFixed(4)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// Token formatter matching the Hermes-style "45.7K / 272K" display.
// Sub-1k stays integer; 1k–99k gets one decimal place; ≥100k rounds
// to the nearest K (no decimal — the precision isn't useful at that
// scale and it keeps the bar's label compact).
function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 100_000) return (n / 1000).toFixed(1) + "K";
  return Math.round(n / 1000) + "K";
}
