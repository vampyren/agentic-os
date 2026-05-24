// Settings → Connectors section (M4a — PR3c, spec §15).
//
// Lists configured connector instances + the Add Provider entry point.
// The UI surface is a thin renderer over the public projection from
// GET /api/connectors (no raw settings / authRef / secrets cross the wire).
//
// Add Provider flow (post-M4a-5 acceptance UX, this commit):
// AddProviderFlow auto-closes on a successful add and hands the new
// connectorId + its testConnection ConnectorValidation back via
// onAdded(). This panel:
//   * refreshes the list,
//   * pre-populates testResults[connectorId] with the validation so the
//     row's ValidationBadge renders immediately (valid OR non-valid;
//     auth-missing surfaces here, same as if the operator had clicked
//     Test), and
//   * highlights the new row for HIGHLIGHT_MS ms so the operator
//     visually locates it without scrolling.
// There is no separate "Added <id>" result screen any more — see the
// comment on AddProviderFlowProps for the full rationale.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchConnectors,
  testConnector,
  type ConnectorListItem,
  type ConnectorValidation,
} from "./api";
import { AddProviderFlow } from "./AddProviderFlow";

const HIGHLIGHT_MS = 3000;

const TRUST_COLORS = {
  "first-party": "#4ade80",
  community: "#fbbf24",
  untrusted: "#f87171",
  unknown: "#71717a",
} as const;

export function ConnectorsPanel() {
  const [connectors, setConnectors] = useState<ConnectorListItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [testResults, setTestResults] = useState<
    Record<string, ConnectorValidation | null>
  >({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    void fetchConnectors().then((list) => {
      setConnectors(list);
      // FU5 PR B — hydrate testResults from the server-provided
      // `lastValidation` for each connector. The server only sends
      // `lastValidation` when the stored connector_health row's
      // configHash matches the recomputed current fingerprint, so an
      // edited-since-test row arrives without `lastValidation` and the
      // UI naturally falls back to "not tested" via StatusPill.
      //
      // We MERGE rather than REPLACE so a fresh local Test or a
      // post-add validation (set via onAdded / onTest) isn't clobbered
      // by a slightly-older server projection. Local writes win for
      // their connectorId; the server fills the gaps.
      setTestResults((prev) => {
        const next: Record<string, ConnectorValidation | null> = { ...prev };
        for (const c of list) {
          if (next[c.connectorId] !== undefined) continue;
          if (c.lastValidation) next[c.connectorId] = c.lastValidation;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => refresh(), [refresh]);

  // Cancel any in-flight highlight timer on unmount so a fast nav-away
  // doesn't fire setState on a stale component.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  async function onTest(id: string) {
    setTesting((t) => ({ ...t, [id]: true }));
    const v = await testConnector(id);
    setTestResults((r) => ({ ...r, [id]: v }));
    setTesting((t) => ({ ...t, [id]: false }));
  }

  function onAdded(connectorId: string, validation: ConnectorValidation | null) {
    refresh();
    // Pre-populate the test result so the new row's ValidationBadge
    // renders immediately — valid OR non-valid. This is what replaces
    // the removed "Added <id>" result screen: the operator sees the
    // testConnection outcome on the row itself, same surface as the
    // Test button would produce.
    if (validation) {
      setTestResults((r) => ({ ...r, [connectorId]: validation }));
    }
    // Brief highlight so the operator visually locates the new row.
    setHighlightedId(connectorId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedId((current) =>
        current === connectorId ? null : current,
      );
      highlightTimerRef.current = null;
    }, HIGHLIGHT_MS);
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Connectors</h1>
          <p className="text-[13px] text-[var(--fg-dim)] mt-1">
            Configured providers. <strong>Add Provider</strong> picks a preset
            and asks for an environment variable NAME — never an API key.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="px-3 py-1.5 text-[12px] border rounded-md hover:opacity-80 shrink-0"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel)",
          }}
        >
          + Add Provider
        </button>
      </header>

      {connectors.length === 0 ? (
        <div className="panel p-8 text-center text-[13px] text-[var(--fg-dim)]">
          No connectors configured yet. Click <em>Add Provider</em> to pick
          one from the catalog.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {connectors.map((c) => (
            <ConnectorRow
              key={c.connectorId}
              connector={c}
              testing={testing[c.connectorId] ?? false}
              validation={testResults[c.connectorId] ?? null}
              highlighted={highlightedId === c.connectorId}
              onTest={() => onTest(c.connectorId)}
            />
          ))}
        </ul>
      )}

      {addOpen && (
        <AddProviderFlow
          onClose={() => setAddOpen(false)}
          onAdded={(connectorId, validation) => {
            setAddOpen(false);
            onAdded(connectorId, validation);
          }}
        />
      )}
    </section>
  );
}

function ConnectorRow({
  connector, testing, validation, highlighted, onTest,
}: {
  connector: ConnectorListItem;
  testing: boolean;
  validation: ConnectorValidation | null;
  /** True for HIGHLIGHT_MS after a successful Add Provider flow — the
   *  row pulses + carries a colored ring so the operator visually
   *  locates the new connector without scrolling. */
  highlighted: boolean;
  onTest(): void;
}) {
  const trustColor = TRUST_COLORS[connector.trust];
  return (
    <li
      className={
        "panel p-4 flex flex-col gap-3 transition-shadow"
        + (highlighted ? " ring-2 ring-emerald-400 animate-pulse" : "")
      }
      style={{
        transitionDuration: "300ms",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        {/*
          Add-flow highlight: when `highlighted` is true the row gets
          ring-2 ring-emerald-400 + animate-pulse for HIGHLIGHT_MS
          (cleared by the parent timeout in ConnectorsPanel). animate-
          pulse fades the row opacity twice over ~3s; the ring keeps a
          steady colored outline so the row stays locatable mid-pulse.
        */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">
              {connector.connectorId}
            </span>
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: trustColor }}
            >
              {connector.trust}
            </span>
          </div>
          <p className="text-[12px] text-[var(--fg-dim)] mt-0.5">
            {connector.typeFamily}
            {connector.presetId ? ` · preset ${connector.presetId}` : ""}
            {" · auth "}{connector.authRefKind}
            {connector.allowLocalNetwork ? " · local-network allowed" : ""}
          </p>
          <p className="text-[11px] text-[var(--fg-dimmer)] mt-1">
            capabilities: {connector.capabilities.join(", ") || "—"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {/*
            Right-side status pill (replaces the previous "ENABLED"
            label per live M4a-5 acceptance feedback). The old badge
            was meaningless without an enable/disable toggle and just
            duplicated the per-row trust label on the left. The useful
            info is the connection-test outcome, glance-readable here:

              - validation present + valid    -> green dot + "valid"
              - validation present + non-valid -> red/yellow dot +
                the status word (invalid / unreachable /
                misconfigured / unknown)
              - validation absent              -> dimmed "not tested"

            The detail ValidationBadge below the row separator stays
            and renders the errorCode + auth-missing hint when
            present. The pill is the glance read; the badge is the
            detail read.

            An enable/disable toggle is intentionally NOT shipped in
            this commit (see issue #35 — M4a-FU4 management modal).
            Until a real toggle exists, surfacing a static "ENABLED"
            label is worse than no label.
          */}
          <StatusPill validation={validation} />
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="px-2 py-1 text-[11px] border rounded-md hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      </div>
      {validation && validation.status !== "valid" && (
        // Live UI review (post-PR-#34-first-commit): a green "valid"
        // pill on the right AND a green "valid" badge on the bottom
        // is redundant. The pill is the at-a-glance source of truth
        // for status; the badge below is only shown when there's
        // useful detail beyond the status word — errorCode or the
        // auth-missing hint. Successful tests show NO bottom badge.
        <ValidationDetail validation={validation} />
      )}
    </li>
  );
}

/** Compact at-a-glance status pill in the row's right column.
 *  Reuses the same status -> color mapping as ValidationBadge so the
 *  pill and the below-row detail badge agree. When `validation` is
 *  null (the connector has never been tested in this session), a
 *  subtle "not tested" label renders instead of any colored dot. */
function StatusPill({
  validation,
}: {
  validation: ConnectorValidation | null;
}) {
  if (!validation) {
    return (
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--fg-dimmer)" }}
      >
        not tested
      </span>
    );
  }
  const { status } = validation;
  const color =
    status === "valid" ? "#4ade80"
    : status === "unknown" ? "#fbbf24"
    : "#f87171";
  return (
    <span
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider"
      style={{ color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {status}
    </span>
  );
}

/** Below-row detail for non-valid validations only. Drops the redundant
 *  status word (the right-side StatusPill already carries it) and
 *  surfaces only the operator-actionable detail: errorCode + the
 *  auth-missing hint + any neutral message. For `status === "valid"`
 *  this component is intentionally NOT rendered — see the gate at
 *  the ConnectorRow call site. */
function ValidationDetail({
  validation,
}: {
  validation: ConnectorValidation;
}) {
  const { errorCode, message } = validation;
  if (!errorCode && !message) return null;
  return (
    <div
      className="border-t pt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-[var(--fg-dim)]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      {errorCode && (
        <span>
          errorCode <code>{errorCode}</code>
        </span>
      )}
      {errorCode === "auth-missing" && (
        <span className="text-[var(--fg-dimmer)]">
          — the named env var is not set in the server process; set it and
          restart Agentic OS.
        </span>
      )}
      {!errorCode && message && <span>{message}</span>}
    </div>
  );
}
