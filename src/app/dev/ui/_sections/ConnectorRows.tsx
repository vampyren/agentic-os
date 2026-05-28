// /dev/ui §4.7 — Connector rows (M4a-FU6 PR B + amend).
//
// Hand-mirror of the ConnectorRow + StatusPill + ValidationDetail
// shapes from src/app/settings/_connectors/ConnectorsPanel.tsx.
// Those components are inline (not exported); refactoring is out of
// scope for PR B (no existing component refactors). Hand-mirror
// references the new --status-* / --trust-* tokens; PR C will
// migrate production to match.
//
// PR B amend (visual polish):
//   - Test button now uses the shared DemoButton (canonical secondary
//     variant). Same family as every other button on /dev/ui.
//   - Status pill + trust badge use the shared DemoBadge component
//     so the row matches §4.8 / §4.9.
//   - The trust badge is rendered as an outlined chip (rounded
//     square), the status pill as a tinted rounded-full pill with a
//     dot — the shape difference makes "trust ≠ status" visually
//     obvious at a glance.
//
// All fixture inputs are illustrative — no live /api/connectors fetch.

import DemoBadge from "@/app/dev/_lib/DemoBadge";
import DemoButton from "@/app/dev/_lib/DemoButton";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function ConnectorRowsSection() {
  return (
    <Section
      anchor="connector-rows"
      number="4.7"
      title="Connector rows"
      fileOfRecord="src/app/settings/_connectors/ConnectorsPanel.tsx"
      kind="hand-mirror"
    >
      <StateRow label="normal" note="idle row; trust chip on the left, status pill on the right">
        <DemoConnectorRow
          connectorId="openai-live"
          typeFamily="openai-compatible-llm"
          presetId="openai"
          authKind="env"
          trust="first-party"
          validation={{ status: "valid" }}
        />
      </StateRow>

      <StateRow label="not tested" note="meta badge on the right (no dot); no below-row detail">
        <DemoConnectorRow
          connectorId="openrouter-prod"
          typeFamily="openai-compatible-llm"
          presetId="openrouter"
          authKind="env"
          trust="first-party"
          validation={null}
        />
      </StateRow>

      <StateRow label="invalid + auth-failed" note="--status-invalid pill + below-row errorCode">
        <DemoConnectorRow
          connectorId="ollama-local"
          typeFamily="openai-compatible-llm"
          presetId="ollama-local"
          authKind="none"
          trust="first-party"
          allowLocalNetwork
          validation={{ status: "invalid", errorCode: "auth-failed" }}
        />
      </StateRow>

      <StateRow label="misconfigured + auth-missing" note="--status-misconfigured + the auth-missing hint">
        <DemoConnectorRow
          connectorId="deepseek-prod"
          typeFamily="openai-compatible-llm"
          presetId="openai-compatible-custom"
          authKind="env"
          trust="community"
          validation={{ status: "misconfigured", errorCode: "auth-missing" }}
        />
      </StateRow>

      <StateRow label="unreachable" note="--status-unreachable (aliased to --status-invalid today)">
        <DemoConnectorRow
          connectorId="claude-sandbox"
          typeFamily="cli-acp-agent"
          authKind="none"
          trust="first-party"
          validation={{ status: "unreachable", errorCode: "network-unreachable" }}
        />
      </StateRow>

      <StateRow label="unknown" note="YELLOW (--status-test-unknown). Distinct from Mission Control's grey 'unknown'.">
        <DemoConnectorRow
          connectorId="hermes-stage"
          typeFamily="cli-acp-agent"
          authKind="none"
          trust="community"
          validation={{ status: "unknown", errorCode: "capability-unavailable" }}
        />
      </StateRow>

      <StateRow label="testing…" note="Test button flips to 'Testing…' (canonical loading verb) and is disabled">
        <DemoConnectorRow
          connectorId="openai-live"
          typeFamily="openai-compatible-llm"
          presetId="openai"
          authKind="env"
          trust="first-party"
          validation={{ status: "valid" }}
          testing
        />
      </StateRow>

      <StateRow label="highlighted" note="3-second ring + pulse after a fresh add; reduced-motion downgrade in §4.14">
        <DemoConnectorRow
          connectorId="openrouter-prod"
          typeFamily="openai-compatible-llm"
          presetId="openrouter"
          authKind="env"
          trust="first-party"
          validation={{ status: "valid" }}
          highlighted
        />
      </StateRow>
    </Section>
  );
}

// ── Hand-mirrored row + status pill + detail components ─────────────

type TrustKind = "first-party" | "community" | "untrusted" | "unknown";
type AuthKind = "env" | "none" | "unset";
type ValidationStatus =
  | "valid"
  | "invalid"
  | "unreachable"
  | "misconfigured"
  | "unknown";

interface DemoValidation {
  status: ValidationStatus;
  errorCode?: string;
}

const TRUST_TOKEN: Record<TrustKind, string> = {
  "first-party": "var(--trust-first-party)",
  community: "var(--trust-community)",
  untrusted: "var(--trust-untrusted)",
  unknown: "var(--trust-unknown)",
};

const STATUS_TOKEN: Record<ValidationStatus, string> = {
  valid: "var(--status-valid)",
  invalid: "var(--status-invalid)",
  unreachable: "var(--status-unreachable)",
  misconfigured: "var(--status-misconfigured)",
  unknown: "var(--status-test-unknown)",
};

function DemoConnectorRow({
  connectorId,
  typeFamily,
  presetId,
  authKind,
  trust,
  allowLocalNetwork = false,
  validation,
  testing = false,
  highlighted = false,
}: {
  connectorId: string;
  typeFamily: string;
  presetId?: string;
  authKind: AuthKind;
  trust: TrustKind;
  allowLocalNetwork?: boolean;
  validation: DemoValidation | null;
  testing?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div
      className={
        "panel p-4 flex flex-col gap-3 transition-shadow w-full max-w-[560px]"
        + (highlighted ? " ring-2 motion-safe:animate-pulse" : "")
      }
      style={{
        borderColor: highlighted
          ? "var(--panel-border-hot)"
          : "var(--panel-border)",
        ...(highlighted
          ? { ["--tw-ring-color" as never]: "var(--status-valid)" }
          : {}),
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">{connectorId}</span>
            <DemoBadge variant="trust" color={TRUST_TOKEN[trust]}>
              {trust}
            </DemoBadge>
          </div>
          <p className="text-[12px] text-[var(--fg-dim)] mt-0.5">
            {typeFamily}
            {presetId ? ` · preset ${presetId}` : ""} · auth {authKind}
            {allowLocalNetwork ? " · local-network allowed" : ""}
          </p>
          <p className="text-[11px] text-[var(--fg-dimmer)] mt-1">
            capabilities: chat.generate
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <DemoTestStatusBadge validation={validation} />
          <DemoButton variant="secondary" size="sm" disabled={testing} loading={testing}>
            {testing ? "Testing…" : "Test"}
          </DemoButton>
        </div>
      </div>
      {validation && validation.status !== "valid" && (
        <DemoValidationDetail validation={validation} />
      )}
    </div>
  );
}

function DemoTestStatusBadge({
  validation,
}: {
  validation: DemoValidation | null;
}) {
  if (!validation) {
    return <DemoBadge variant="meta">not tested</DemoBadge>;
  }
  return (
    <DemoBadge variant="status" color={STATUS_TOKEN[validation.status]}>
      {validation.status}
    </DemoBadge>
  );
}

function DemoValidationDetail({ validation }: { validation: DemoValidation }) {
  const { errorCode } = validation;
  if (!errorCode) return null;
  return (
    <div
      className="border-t pt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-[var(--fg-dim)]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <span>
        errorCode <code className="text-[var(--fg)]">{errorCode}</code>
      </span>
      {errorCode === "auth-missing" && (
        <span className="text-[var(--fg-dimmer)]">
          — the named env var is not set in the server process; set it and restart Agentic OS.
        </span>
      )}
    </div>
  );
}
