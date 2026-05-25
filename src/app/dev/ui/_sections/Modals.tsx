// /dev/ui §4.11 — Modals (M4a-FU6 PR B + amend / Rex review #2).
//
// CANONICAL TARGET (not a strict mirror) — see FU6 spec §3.2 and
// UI-GUIDELINES.md §5.5. AddProviderFlow.tsx production today renders
// its modal header differently (no centered title block, raw `×`
// character close, etc.); the goal here is the TARGET that production
// can converge toward in a later alignment PR.
//
// PR B amend review #2:
//   - Back / Close render with TEXT LABELS via DemoButton ghost size sm,
//     not lucide-react icon-only buttons. The earlier icon-only round
//     rendered as empty boxes inside the modal header on at least one
//     reviewer's environment; reliable text-labels are the durable
//     solution and read more clearly without aria-label.
//   - Modal header still uses the three-column [auto · centered title
//     block · auto] grid so the provider name and subtitle slot remain
//     prominent.
//   - Success-carve-out demo shows `[hidden secret value]` (neutral),
//     NOT a fake `sk-…` shape — the real SecretField is M4a-6b scope.

import DemoButton from "@/app/dev/_lib/DemoButton";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function ModalsSection() {
  return (
    <Section
      anchor="modals"
      number="4.11"
      title="Modals"
      fileOfRecord="src/app/settings/_connectors/AddProviderFlow.tsx"
      kind="target"
    >
      <StateRow label="header Close (top-right)" note="always present; Escape equivalent. Clean text label, not the raw '×' character.">
        <DemoModal title="Add Provider" subtitle="Pick a preset to start" showClose primary="Add" />
      </StateRow>

      <StateRow label="Back + provider name" note="step 2 of a flow. Back is a clean text-label button; provider name reads as the header.">
        <DemoModal
          title="OpenAI"
          subtitle="openai-compatible-llm · preset openai"
          showBack
          showClose
          primary="Add"
        />
      </StateRow>

      <StateRow label="primary + secondary footer" note="single-primary rule; secondary only when it serves a non-cancel purpose">
        <DemoModal
          title="Add Provider"
          subtitle="Pick a preset to start"
          showClose
          primary="Add"
          secondary="Load models"
        />
      </StateRow>

      <StateRow label="body — loading skeleton" note="modal-open / preset-load state">
        <DemoModal
          title="Add Provider"
          subtitle="Loading presets…"
          showClose
          primary="Add"
          primaryDisabled
        >
          <DemoSkeleton lines={4} />
        </DemoModal>
      </StateRow>

      <StateRow label="body — inline error" note="neutral message; no raw provider response">
        <DemoModal
          title="Add Provider"
          subtitle="Discovery failed"
          showClose
          primary="Retry"
        >
          <div className="text-[13px]" style={{ color: "var(--status-invalid)" }}>
            Could not reach the provider. Check the Base URL.
          </div>
        </DemoModal>
      </StateRow>

      <StateRow label="success — auto-close (default)" note="no modal rendered after a fresh-create; row pulses in the list (see §4.14)">
        <p className="text-[12px] text-[var(--fg-dim)] py-2">
          No modal rendered after a successful create — the flow auto-closes
          and the new row pulses in the list (see <code>§4.14</code>).
        </p>
      </StateRow>

      <StateRow
        label="success — carve-out"
        note="copy / download / one-time-confirmation cases (round-2 #7). Document each use."
      >
        <DemoModal
          title="API key saved"
          subtitle="copy now if you need a record"
          primary="I've copied it"
        >
          <p className="text-[13px] text-[var(--fg-dim)]">
            Your secret is now stored. <strong>You will not see it again.</strong>
          </p>
          <div
            className="mt-3 px-3 py-2 rounded font-mono text-[12px] flex items-center justify-between"
            style={{
              background: "var(--bg-elevated-hot)",
              color: "var(--fg-dim)",
              border: "1px solid var(--panel-border)",
            }}
          >
            <span>[hidden secret value]</span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)]">
              preview only — M4a-6b
            </span>
          </div>
        </DemoModal>
      </StateRow>
    </Section>
  );
}

function DemoModal({
  title,
  subtitle,
  children,
  primary,
  primaryDisabled = false,
  secondary,
  showClose = false,
  showBack = false,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  primary: string;
  primaryDisabled?: boolean;
  secondary?: string;
  showClose?: boolean;
  showBack?: boolean;
}) {
  return (
    <div
      className="rounded-lg border w-[440px] flex flex-col"
      style={{
        background: "var(--bg)",
        borderColor: "var(--panel-border-hot)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {/* Three-column header: Back (left, text-label) · centered
          title block · Close (right, text-label). Auto-width side
          columns so the text-label buttons size to their content; the
          centered title block stays visually centered because the
          left + right columns balance on equal-flex distribution. */}
      <header
        className="grid grid-cols-[auto_1fr_auto] items-center px-4 py-3 border-b gap-3"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <div className="flex justify-start min-w-[60px]">
          {showBack ? (
            <DemoButton variant="ghost" size="sm">
              Back
            </DemoButton>
          ) : (
            <span aria-hidden className="inline-block min-w-[60px]" />
          )}
        </div>
        <div className="flex flex-col items-center text-center min-w-0">
          <span className="text-[15px] font-medium tracking-tight truncate max-w-full">
            {title}
          </span>
          {subtitle && (
            <span className="text-[11px] text-[var(--fg-dimmer)] mt-0.5 truncate max-w-full">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex justify-end min-w-[60px]">
          {showClose ? (
            <DemoButton variant="ghost" size="sm">
              Close
            </DemoButton>
          ) : (
            <span aria-hidden className="inline-block min-w-[60px]" />
          )}
        </div>
      </header>

      <div className="p-4 flex flex-col gap-2 text-[13px]">
        {children ?? (
          <p className="text-[13px] text-[var(--fg-dim)]">
            (modal body — fixture text only)
          </p>
        )}
      </div>

      <footer
        className="flex items-center justify-end gap-2 px-4 py-3 border-t"
        style={{ borderColor: "var(--panel-border)" }}
      >
        {secondary && (
          <DemoButton variant="secondary" size="md">
            {secondary}
          </DemoButton>
        )}
        <DemoButton variant="primary" size="md" disabled={primaryDisabled}>
          {primary}
        </DemoButton>
      </footer>
    </div>
  );
}

function DemoSkeleton({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className="block h-2 rounded motion-safe:animate-pulse"
          style={{
            background: "var(--bg-elevated-hot)",
            width: `${100 - i * 12}%`,
          }}
        />
      ))}
    </div>
  );
}
