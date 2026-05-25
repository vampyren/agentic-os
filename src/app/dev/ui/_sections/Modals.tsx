// /dev/ui §4.11 — Modals (M4a-FU6 PR B).
//
// Hand-mirror of the modal shapes from
// src/app/settings/_connectors/AddProviderFlow.tsx. Renders three
// modal states side-by-side as static demos (not actually opened
// over an overlay — that would cover the rest of /dev/ui). Each
// example shows: header Close (top-right), optional ← Back
// (top-left), modal body, footer with a SINGLE primary action.
// Closes are demos only — clicks are inert.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function ModalsSection() {
  return (
    <Section
      anchor="modals"
      number="4.11"
      title="Modals"
      fileOfRecord="src/app/settings/_connectors/AddProviderFlow.tsx"
    >
      <StateRow label="header Close (top-right)" note="always present; Escape equivalent">
        <DemoModal
          title="Add Provider"
          showClose
          primaryLabel="Add"
        >
          <p className="text-[13px] text-[var(--fg-dim)]">
            Pick a preset to start the configuration flow. The
            preset's defaults pre-fill the form.
          </p>
        </DemoModal>
      </StateRow>

      <StateRow
        label="← Back (top-left)"
        note="when mid-flow (step 2 of N). Does NOT duplicate Close."
      >
        <DemoModal
          title="Configure OpenAI"
          showBack
          showClose
          primaryLabel="Add"
        >
          <p className="text-[13px] text-[var(--fg-dim)]">
            Step 2 of 2. ← Back returns to preset picker; Close
            exits the modal entirely.
          </p>
        </DemoModal>
      </StateRow>

      <StateRow label="footer — single primary action" note="no redundant Cancel button (PR #33)">
        <DemoModal
          title="Add Provider"
          showClose
          primaryLabel="Add"
          secondaryLabel="Load models"
        >
          <p className="text-[13px] text-[var(--fg-dim)]">
            Secondary actions only when they serve a non-cancel purpose
            (here: Load models is a discovery action, not a cancel).
          </p>
        </DemoModal>
      </StateRow>

      <StateRow label="body — loading skeleton" note="modal-open / preset-load state">
        <DemoModal
          title="Add Provider"
          showClose
          primaryLabel="Add"
          primaryDisabled
        >
          <DemoSkeleton lines={4} />
        </DemoModal>
      </StateRow>

      <StateRow label="body — inline error" note="neutral message map; no raw provider response">
        <DemoModal
          title="Add Provider"
          showClose
          primaryLabel="Retry"
        >
          <div className="text-[13px]" style={{ color: "var(--status-invalid)" }}>
            Could not reach the provider. Check the Base URL.
          </div>
        </DemoModal>
      </StateRow>

      <StateRow
        label="success — auto-close (default)"
        note="modal closes; new row in the list pulses for 3s; see §4.14"
      >
        <p className="text-[12px] text-[var(--fg-dim)]">
          No modal rendered after a successful create — the flow auto-closes
          and the new row pulses in the list (see <code>§4.14</code>).
        </p>
      </StateRow>

      <StateRow
        label="success — carve-out (copy / download / one-time confirmation)"
        note="round-2 #7. Document each use; default path is auto-close."
      >
        <DemoModal
          title="API key saved"
          primaryLabel="I've copied it"
        >
          <p className="text-[13px] text-[var(--fg-dim)]">
            Your API key is now stored. <strong>You will not see it again.</strong>
            Copy it now if you need a record.
          </p>
          <div
            className="mt-3 px-3 py-2 rounded font-mono text-[12px]"
            style={{ background: "var(--bg-elevated-hot)", color: "var(--fg-dim)" }}
          >
            sk-•••• (preview only — M4a-6b owns this)
          </div>
        </DemoModal>
      </StateRow>
    </Section>
  );
}

function DemoModal({
  title,
  children,
  primaryLabel,
  primaryDisabled = false,
  secondaryLabel,
  showClose = false,
  showBack = false,
}: {
  title: string;
  children: React.ReactNode;
  primaryLabel: string;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  showClose?: boolean;
  showBack?: boolean;
}) {
  return (
    <div
      className="rounded-lg border w-[420px] flex flex-col"
      style={{
        background: "var(--bg)",
        borderColor: "var(--panel-border-hot)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--panel-border)" }}
      >
        {showBack ? (
          <button
            type="button"
            className="text-[12px] text-[var(--fg-dim)] cursor-default"
            aria-label="Back"
          >
            ← Back
          </button>
        ) : (
          <span aria-hidden />
        )}
        <span className="text-[13px] font-medium">{title}</span>
        {showClose ? (
          <button
            type="button"
            className="text-[14px] text-[var(--fg-dim)] cursor-default"
            aria-label="Close"
          >
            ×
          </button>
        ) : (
          <span aria-hidden />
        )}
      </header>
      <div className="p-4 flex flex-col gap-2 text-[13px]">{children}</div>
      <footer
        className="flex items-center justify-end gap-2 px-4 py-3 border-t"
        style={{ borderColor: "var(--panel-border)" }}
      >
        {secondaryLabel && (
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] rounded-md border cursor-default"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          disabled={primaryDisabled}
          aria-disabled={primaryDisabled || undefined}
          className="px-3 py-1.5 text-[12px] rounded-md cursor-default disabled:opacity-50"
          style={{
            background: "var(--fg)",
            color: "var(--bg)",
          }}
        >
          {primaryLabel}
        </button>
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
