// /dev/ui §4.14 — Auto-close + highlighted-row pattern (M4a-FU6 PR B).
//
// The post-successful-add pattern from PR #34: modal closes, list
// refreshes, new row pulses with an emerald ring for ~3 seconds,
// highlight clears automatically. The reduced-motion downgrade drops
// the pulse to a static ring for the same 3-second window.
//
// This section walks through the lifecycle as 5 numbered frames so
// a reviewer can see each stage. No actual timer / hooks — pure
// static demo (server component).

import DemoBadge from "@/app/dev/_lib/DemoBadge";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function AutoCloseHighlightSection() {
  return (
    <Section
      anchor="auto-close-highlight"
      number="4.14"
      title="Auto-close + highlighted-row pattern"
      fileOfRecord="src/app/settings/_connectors/ConnectorsPanel.tsx (onAdded; PR #34 pattern)"
    >
      <p className="text-[12px] text-[var(--fg-dim)] pb-2">
        Five-frame lifecycle. Times are illustrative; actual constant is{" "}
        <code>HIGHLIGHT_MS = 3000</code> in <code>ConnectorsPanel.tsx</code>.
      </p>

      <StateRow label="t = 0" note="operator clicks Add inside the Add Provider modal">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[var(--fg-dim)]">[modal still open · Adding…]</span>
        </div>
      </StateRow>

      <StateRow label="t = 0.5s" note="successful add → modal closes; list refreshes">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[var(--fg-dim)]">[modal closed]</span>
        </div>
      </StateRow>

      <StateRow label="t = 1–3s — default" note="new row pulses; --status-valid ring">
        <DemoHighlightRow pulse />
      </StateRow>

      <StateRow label="t = 1–3s — reduced motion" note="static ring; no pulse">
        <DemoHighlightRow pulse={false} />
      </StateRow>

      <StateRow label="t > 3s" note="highlight cleared; row returns to normal styling">
        <DemoHighlightRow pulse={false} cleared />
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-4 pb-1">
        Rules
      </header>

      <ul className="list-disc pl-5 text-[12px] text-[var(--fg-dim)] space-y-1">
        <li>Operator does not dismiss anything — the highlight fades automatically.</li>
        <li>
          <strong>Carve-out (issue #37 round-2 #7):</strong> if the success requires user action
          (copy a generated value, download a file, confirm a one-time visible value — e.g.
          M4a-6b's "your API key is now stored; you will not see it again"), the modal stays
          open at a confirmation step. Document each use of the carve-out.
        </li>
        <li>
          No "Added <code>&lt;id&gt;</code>" intermediate screen with separate Close + Done
          buttons (PR #34 removed it).
        </li>
        <li>Focus returns to the trigger after close (PR #34's <code>onModelBlur</code> defer pattern is prior art).</li>
      </ul>
    </Section>
  );
}

function DemoHighlightRow({
  pulse,
  cleared = false,
}: {
  pulse: boolean;
  cleared?: boolean;
}) {
  return (
    <div
      className={
        "panel p-3 w-[420px] flex items-center justify-between gap-3"
        + (cleared ? "" : " ring-2")
        + (pulse ? " motion-safe:animate-pulse" : "")
      }
      style={{
        borderColor: "var(--panel-border)",
        ...(cleared ? {} : { ["--tw-ring-color" as never]: "var(--status-valid)" }),
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">openrouter-prod</span>
          <DemoBadge variant="trust" color="var(--trust-first-party)">first-party</DemoBadge>
        </div>
        <p className="text-[11px] text-[var(--fg-dim)] mt-0.5">
          openai-compatible-llm · preset openrouter · auth env
        </p>
      </div>
      <DemoBadge variant="status" color="var(--status-valid)">valid</DemoBadge>
    </div>
  );
}
