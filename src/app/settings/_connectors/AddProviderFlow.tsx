// Add Provider flow (M4a — PR3c, spec §15).
//
// A two-step modal: pick a preset from the catalog, then fill in the
// connector id + env var name (per the preset's authPrompt) + any custom
// settings (custom-endpoint presets). On submit, POSTs to /api/connectors;
// on success, runs a connector test and shows the result.
//
// Env-var UX (req 4): the auth field asks for the NAME of an environment
// variable that holds the API key — not the key itself. Copy explains the
// variable must exist in the server process and that adding it may require
// restarting Agentic OS. If absent, testConnection will report
// `auth-missing`.

"use client";

import { useEffect, useState } from "react";
import {
  addConnector,
  fetchPresets,
  testConnector,
  type AddConnectorResult,
  type ConnectorPreset,
  type ConnectorValidation,
} from "./api";

type Step = "picking" | "filling" | "result";

interface AddProviderFlowProps {
  onClose(): void;
  onAdded(): void;
}

const TRUST_COLORS: Record<ConnectorPreset["trust"], string> = {
  "first-party": "#4ade80",
  community: "#fbbf24",
  untrusted: "#f87171",
};

export function AddProviderFlow({ onClose, onAdded }: AddProviderFlowProps) {
  const [step, setStep] = useState<Step>("picking");
  const [presets, setPresets] = useState<ConnectorPreset[]>([]);
  const [chosen, setChosen] = useState<ConnectorPreset | null>(null);
  const [connectorId, setConnectorId] = useState("");
  const [envVar, setEnvVar] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [allowLocalNetwork, setAllowLocalNetwork] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<AddConnectorResult | null>(null);
  const [validation, setValidation] = useState<ConnectorValidation | null>(null);

  useEffect(() => {
    void fetchPresets().then(setPresets);
  }, []);

  function pickPreset(p: ConnectorPreset) {
    setChosen(p);
    setConnectorId(p.id);
    setEnvVar("");
    const defaultBase = (p.defaultSettings.baseUrl as string | undefined) ?? "";
    setBaseUrl(defaultBase);
    setModel((p.defaultSettings.model as string | undefined) ?? "");
    setAllowLocalNetwork(p.allowLocalNetwork ?? false);
    setSubmitError(null);
    setStep("filling");
  }

  async function submit() {
    if (!chosen) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const settings: Record<string, unknown> = {};
      // Operator overrides for the fields the preset exposed (or the
      // custom-endpoint case where the preset's defaults are empty).
      const defaultBase = (chosen.defaultSettings.baseUrl as string | undefined) ?? "";
      const defaultModel = (chosen.defaultSettings.model as string | undefined) ?? "";
      if (baseUrl && baseUrl !== defaultBase) settings.baseUrl = baseUrl;
      if (model && model !== defaultModel) settings.model = model;

      const body: Parameters<typeof addConnector>[0] = {
        connectorId,
        presetId: chosen.id,
      };
      if (envVar.trim()) body.authRef = `env:${envVar.trim()}`;
      if (Object.keys(settings).length > 0) body.settings = settings;
      if (allowLocalNetwork) body.allowLocalNetwork = true;

      const result = await addConnector(body);
      setAddResult(result);
      if (result.ok) {
        // Run a connection test immediately so the operator sees the result.
        const v = await testConnector(result.connector.connectorId);
        setValidation(v);
        setStep("result");
      } else {
        setSubmitError(result.error);
      }
    } catch {
      setSubmitError("could not add connector");
    } finally {
      setSubmitting(false);
    }
  }

  function close(refreshed: boolean) {
    if (refreshed) onAdded();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => close(false)}
    >
      <div
        className="panel w-full max-w-[640px] max-h-[80vh] overflow-auto flex flex-col gap-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Add Provider</h2>
          <button
            type="button"
            className="text-[12px] text-[var(--fg-dimmer)]"
            onClick={() => close(false)}
          >
            Close
          </button>
        </header>

        {step === "picking" && (
          <PresetPicker presets={presets} onPick={pickPreset} />
        )}

        {step === "filling" && chosen && (
          <PresetForm
            preset={chosen}
            connectorId={connectorId}
            setConnectorId={setConnectorId}
            envVar={envVar}
            setEnvVar={setEnvVar}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            model={model}
            setModel={setModel}
            allowLocalNetwork={allowLocalNetwork}
            setAllowLocalNetwork={setAllowLocalNetwork}
            submitting={submitting}
            submitError={submitError}
            onBack={() => setStep("picking")}
            onSubmit={submit}
          />
        )}

        {step === "result" && addResult?.ok && (
          <AddResult
            connectorId={addResult.connector.connectorId}
            validation={validation}
            onDone={() => close(true)}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1 — preset picker ─────────────────────────────────────────────────

function PresetPicker({
  presets,
  onPick,
}: {
  presets: ConnectorPreset[];
  onPick(p: ConnectorPreset): void;
}) {
  if (presets.length === 0) {
    return (
      <p className="text-[13px] text-[var(--fg-dim)]">Loading catalog…</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--fg-dim)]">
        Pick a provider preset. First-party presets ship with the build;
        community presets come from <code>~/.agentic-os/presets/</code>.
      </p>
      <ul className="flex flex-col gap-2">
        {presets.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="panel w-full text-left p-3 flex items-start gap-3 hover:opacity-90"
              onClick={() => onPick(p)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{p.label}</span>
                  <span
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: TRUST_COLORS[p.trust] }}
                  >
                    {p.trust}
                  </span>
                </div>
                {p.description && (
                  <p className="text-[12px] text-[var(--fg-dim)] mt-0.5">
                    {p.description}
                  </p>
                )}
              </div>
              <span
                className="text-[11px] text-[var(--fg-dimmer)] shrink-0"
                aria-hidden="true"
              >
                {p.typeFamily}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Step 2 — preset form ───────────────────────────────────────────────────

interface PresetFormProps {
  preset: ConnectorPreset;
  connectorId: string;
  setConnectorId(v: string): void;
  envVar: string;
  setEnvVar(v: string): void;
  baseUrl: string;
  setBaseUrl(v: string): void;
  model: string;
  setModel(v: string): void;
  allowLocalNetwork: boolean;
  setAllowLocalNetwork(v: boolean): void;
  submitting: boolean;
  submitError: string | null;
  onBack(): void;
  onSubmit(): void;
}

function PresetForm(props: PresetFormProps) {
  const {
    preset, connectorId, setConnectorId, envVar, setEnvVar, baseUrl,
    setBaseUrl, model, setModel, allowLocalNetwork, setAllowLocalNetwork,
    submitting, submitError, onBack, onSubmit,
  } = props;
  const wantsApiKey = Boolean(preset.authPrompt?.apiKeyEnvVar);
  const wantsBaseUrl = Boolean(preset.authPrompt?.baseUrl)
    || !(preset.defaultSettings.baseUrl as string | undefined);
  const wantsModel = !(preset.defaultSettings.model as string | undefined);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) onSubmit();
      }}
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          className="text-[12px] text-[var(--fg-dimmer)]"
          onClick={onBack}
        >
          ← Back
        </button>
        <h3 className="text-[14px] font-medium">{preset.label}</h3>
      </header>

      <Field label="Connector id" hint="Lower-case slug. Used as the API + ledger identifier.">
        <input
          className="w-full bg-transparent border rounded-md px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-[color:var(--panel-border-hot)]"
            style={{ borderColor: "var(--panel-border)" }}
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          required
          pattern="[a-z0-9][a-z0-9-]{0,63}"
        />
      </Field>

      {wantsApiKey && (
        <Field
          label={preset.authPrompt?.apiKeyEnvVar?.label
            ?? "Name of the environment variable holding the API key"}
          hint={
            <>
              The named env var must already exist in the server process.
              Adding it may require restarting Agentic OS. The raw key is
              never sent or stored — only the variable NAME is.
              {preset.authPrompt?.apiKeyEnvVar?.helpUrl && (
                <>
                  {" "}
                  <a
                    href={preset.authPrompt.apiKeyEnvVar.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Where to get a key →
                  </a>
                </>
              )}
            </>
          }
        >
          <input
            className="w-full bg-transparent border rounded-md px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-[color:var(--panel-border-hot)]"
            style={{ borderColor: "var(--panel-border)" }}
            placeholder="e.g. OPENAI_API_KEY"
            value={envVar}
            onChange={(e) => setEnvVar(e.target.value)}
            pattern="[A-Za-z_][A-Za-z0-9_]*"
          />
        </Field>
      )}

      {wantsBaseUrl && (
        <Field label={preset.authPrompt?.baseUrl?.label ?? "Base URL"}>
          <input
            className="w-full bg-transparent border rounded-md px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-[color:var(--panel-border-hot)]"
            style={{ borderColor: "var(--panel-border)" }}
            placeholder="https://…"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
      )}
      {wantsModel && (
        <Field label="Model">
          <input
            className="w-full bg-transparent border rounded-md px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-[color:var(--panel-border-hot)]"
            style={{ borderColor: "var(--panel-border)" }}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
      )}

      <label className="flex items-center gap-2 text-[13px] text-[var(--fg-dim)]">
        <input
          type="checkbox"
          checked={allowLocalNetwork}
          onChange={(e) => setAllowLocalNetwork(e.target.checked)}
        />
        Allow local network (private / loopback / link-local addresses)
      </label>

      {submitError && (
        <p className="text-[12px]" style={{ color: "#f87171" }}>
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          className="text-[12px] text-[var(--fg-dimmer)]"
          onClick={onBack}
          disabled={submitting}
        >
          Cancel
        </button>
        <button type="submit" className="px-3 py-1.5 text-[12px] border rounded-md hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }} disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label, hint, children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px]">
      <span className="text-[12px] uppercase tracking-wider text-[var(--fg-dimmer)]">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[12px] text-[var(--fg-dimmer)]">{hint}</span>
      )}
    </label>
  );
}

// ── Step 3 — result ────────────────────────────────────────────────────────

function AddResult({
  connectorId, validation, onDone,
}: {
  connectorId: string;
  validation: ConnectorValidation | null;
  onDone(): void;
}) {
  const status = validation?.status ?? "unknown";
  const color =
    status === "valid" ? "#4ade80" : status === "unknown" ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]">
        Added <code>{connectorId}</code>.
      </p>
      <div className="panel p-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider" style={{ color }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
          connection test: {status}
        </div>
        {validation?.errorCode && (
          <p className="text-[12px] text-[var(--fg-dim)]">
            errorCode: <code>{validation.errorCode}</code>
            {validation.errorCode === "auth-missing" && (
              <>
                {" "}
                — the named env var isn't set in the server process. Set it
                and restart Agentic OS, then re-test.
              </>
            )}
          </p>
        )}
        {validation?.message && (
          <p className="text-[12px] text-[var(--fg-dim)]">{validation.message}</p>
        )}
      </div>
      <div className="flex justify-end">
        <button type="button" className="px-3 py-1.5 text-[12px] border rounded-md hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
