// Settings → Connectors section (M4a — PR3c, spec §15).
//
// Lists configured connector instances + the Add Provider entry point.
// The UI surface is a thin renderer over the public projection from
// GET /api/connectors (no raw settings / authRef / secrets cross the wire).

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchConnectors,
  testConnector,
  type ConnectorListItem,
  type ConnectorValidation,
} from "./api";
import { AddProviderFlow } from "./AddProviderFlow";

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

  const refresh = useCallback(() => {
    void fetchConnectors().then(setConnectors);
  }, []);

  useEffect(() => refresh(), [refresh]);

  async function onTest(id: string) {
    setTesting((t) => ({ ...t, [id]: true }));
    const v = await testConnector(id);
    setTestResults((r) => ({ ...r, [id]: v }));
    setTesting((t) => ({ ...t, [id]: false }));
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
              onTest={() => onTest(c.connectorId)}
            />
          ))}
        </ul>
      )}

      {addOpen && (
        <AddProviderFlow
          onClose={() => setAddOpen(false)}
          onAdded={refresh}
        />
      )}
    </section>
  );
}

function ConnectorRow({
  connector, testing, validation, onTest,
}: {
  connector: ConnectorListItem;
  testing: boolean;
  validation: ConnectorValidation | null;
  onTest(): void;
}) {
  const trustColor = TRUST_COLORS[connector.trust];
  return (
    <li className="panel p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
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
          <span
            className="text-[10px] uppercase tracking-wider"
            style={{ opacity: connector.enabled ? 1 : 0.5 }}
          >
            {connector.enabled ? "enabled" : "disabled"}
          </span>
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
      {validation && <ValidationBadge validation={validation} />}
    </li>
  );
}

function ValidationBadge({
  validation,
}: {
  validation: ConnectorValidation;
}) {
  const { status, errorCode } = validation;
  const color =
    status === "valid" ? "#4ade80"
    : status === "unknown" ? "#fbbf24"
    : "#f87171";
  return (
    <div
      className="border-t pt-2 flex items-center gap-2 text-[12px]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      <span style={{ color }}>{status}</span>
      {errorCode && (
        <span className="text-[var(--fg-dim)]">
          · errorCode <code>{errorCode}</code>
        </span>
      )}
      {errorCode === "auth-missing" && (
        <span className="text-[var(--fg-dimmer)]">
          — the named env var is not set in the server process; set it and
          restart Agentic OS.
        </span>
      )}
    </div>
  );
}
