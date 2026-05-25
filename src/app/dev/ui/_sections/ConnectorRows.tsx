// /dev/ui §4.7 — Connector rows (M4a-FU6 PR B).
//
// Hand-mirror of the ConnectorRow + StatusPill + ValidationDetail
// shapes from src/app/settings/_connectors/ConnectorsPanel.tsx.
// Those components are inline (not exported); refactoring them to
// export is out of scope for PR B (no existing component refactors).
// Hand-mirror copies the JSX shape verbatim and references the new
// `--status-*` / `--trust-*` tokens instead of the production inline
// hex. PR C is what migrates the production component to match.
//
// All connector data here is fixture-only — no live `/api/connectors`
// fetch (§3.4 / §9).

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function ConnectorRowsSection() {
  return (
    <Section
      anchor="connector-rows"
      number="4.7"
      title="Connector rows"
      fileOfRecord="src/app/settings/_connectors/ConnectorsPanel.tsx"
    >
      <StateRow label="normal" note="idle row; right-side StatusPill carries glance status">
        <DemoConnectorRow
          connectorId="openai-live"
          typeFamily="openai-compatible-llm"
          presetId="openai"
          authKind="env"
          trust="first-party"
          validation={{ status: "valid" }}
        />
      </StateRow>

      <StateRow label="not tested" note="dimmed text on the right; no dot; no below-row detail">
        <DemoConnectorRow
          connectorId="openrouter-prod"
          typeFamily="openai-compatible-llm"
          presetId="openrouter"
          authKind="env"
          trust="first-party"
          validation={null}
        />
      </StateRow>

      <StateRow label="invalid + auth-failed" note="red pill + below-row errorCode">
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

      <StateRow label="unreachable" note="red dot; same color family as invalid (aliased)">
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

      <StateRow label="testing…" note="Test button flips to 'Testing…' and is disabled">
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

// ── Hand-mirrored row + pill + detail components ────────────────────

const TRUST_COLOR: Record<TrustKind, string> = {
  "first-party": "var(--trust-first-party)",
  community: "var(--trust-community)",
  untrusted: "var(--trust-untrusted)",
  unknown: "var(--trust-unknown)",
};

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
        + (highlighted
          ? " ring-2 motion-safe:animate-pulse"
          : "")
      }
      style={{
        borderColor: "var(--panel-border)",
        // ring color via Tailwind arbitrary value referencing the new token.
        ...(highlighted ? { ["--tw-ring-color" as never]: "var(--status-valid)" } : {}),
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">{connectorId}</span>
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: TRUST_COLOR[trust] }}
            >
              {trust}
            </span>
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
          <DemoStatusPill validation={validation} />
          <button
            type="button"
            disabled={testing}
            aria-disabled={testing || undefined}
            className="px-2 py-1 text-[11px] border rounded-md hover:opacity-80 disabled:opacity-50 cursor-default"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      </div>
      {validation && validation.status !== "valid" && (
        <DemoValidationDetail validation={validation} />
      )}
    </div>
  );
}

/** Hand-mirror of ConnectorsPanel.StatusPill. Uses the new connector-
 *  test status tokens (--status-valid / --status-invalid / etc.) rather
 *  than the inline hex production currently carries; PR C ports
 *  production to match. */
function DemoStatusPill({ validation }: { validation: DemoValidation | null }) {
  if (!validation) {
    return (
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--status-not-tested)" }}
      >
        not tested
      </span>
    );
  }
  const { status } = validation;
  const color =
    status === "valid"
      ? "var(--status-valid)"
      : status === "unknown"
      ? "var(--status-test-unknown)"
      : status === "unreachable"
      ? "var(--status-unreachable)"
      : status === "misconfigured"
      ? "var(--status-misconfigured)"
      : "var(--status-invalid)";

  return (
    <span
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider"
      style={{ color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}

/** Hand-mirror of ConnectorsPanel.ValidationDetail — non-valid only;
 *  renders errorCode + auth-missing hint. Production already uses
 *  neutral message helpers (§9 non-leak); this demo is consistent. */
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
