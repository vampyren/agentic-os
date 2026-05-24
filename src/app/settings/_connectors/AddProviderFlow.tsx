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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addConnector,
  discoverModels,
  fetchPresets,
  testConnector,
  type ConnectorPreset,
  type ConnectorValidation,
  type DiscoveredModel,
} from "./api";
import { ModelPicker, MODEL_PICKER_VISIBLE_CAP } from "./ModelPicker";

// Two steps only. The previous third step ("result") rendered an "Added
// <id>" panel with its own Close + Done buttons on top of the modal's
// header Close — three close-related affordances for one outcome. Rex
// hit this during M4a-5 live acceptance and asked for it gone:
//
//   * The header Cancel button was removed in PR #33.
//   * The result step is removed here: after a successful add, the modal
//     auto-closes and ConnectorsPanel highlights the newly-added row.
//
// Failure paths (add itself failed) stay in the "filling" step with a
// neutral submitError shown inline; the operator doesn't get bounced out
// of their half-typed form. testConnection results — including non-valid
// outcomes like `auth-missing` — propagate to ConnectorsPanel via
// onAdded(connectorId, validation) and surface as the same
// ValidationBadge the row already uses when the operator clicks Test.
// One source of truth, no redundant warning screens.
//
// Do NOT reintroduce the third step. If a future case truly needs a
// dedicated post-add warning surface, prefer extending the row badge.
type Step = "picking" | "filling";

interface AddProviderFlowProps {
  onClose(): void;
  /**
   * Called after a successful POST /api/connectors + testConnection.
   *   `connectorId` — the id the server confirmed.
   *   `validation`  — the testConnection result (may be `null` if the
   *                   call itself threw; the row will pick up status on
   *                   the next Test click). Non-valid statuses
   *                   (`auth-missing`, etc.) flow through here so the
   *                   parent can pre-populate testResults[connectorId]
   *                   and the row's ValidationBadge surfaces the warning.
   */
  onAdded(connectorId: string, validation: ConnectorValidation | null): void;
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
      if (result.ok) {
        // Run a connection test immediately so the new row's
        // ValidationBadge can render the result without the operator
        // clicking Test. The validation (valid OR non-valid) is handed
        // up to ConnectorsPanel via onAdded(); see the explanatory
        // comment on AddProviderFlowProps above.
        const v = await testConnector(result.connector.connectorId);
        onAdded(result.connector.connectorId, v);
        onClose();
      } else {
        setSubmitError(result.error);
      }
    } catch {
      setSubmitError("could not add connector");
    } finally {
      setSubmitting(false);
    }
  }

  // Closes the modal without a successful add (operator hit Close or
  // clicked the backdrop). No refresh; nothing was added.
  function closeWithoutAdd() {
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={closeWithoutAdd}
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
            onClick={closeWithoutAdd}
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
  // For openai-compatible-llm presets, ALWAYS show the Base URL field
  // pre-filled with the preset default — Ollama / local users must be able
  // to change host or port (server-side SSRF guard remains authoritative).
  const wantsBaseUrl = preset.typeFamily === "openai-compatible-llm"
    || Boolean(preset.authPrompt?.baseUrl)
    || !(preset.defaultSettings.baseUrl as string | undefined);
  // The Model field is rendered for openai-compatible-llm presets (so the
  // discovery picker can pre-fill it) and for any other preset that has no
  // default model. Manual entry remains available either way.
  const wantsModel = preset.typeFamily === "openai-compatible-llm"
    || !(preset.defaultSettings.model as string | undefined);
  // Discovery is wired for openai-compatible-llm; other families lack a
  // listModels surface. (The route still returns capability-not-supported
  // neutrally if the operator triggers it on a non-discovery family.)
  const canDiscover = preset.typeFamily === "openai-compatible-llm";

  // ── Model discovery state (M4a-5 PR C) ───────────────────────────────────
  // - `models === null`  -> Load models hasn't run yet (or failed cleanly).
  // - `models === []`    -> Loaded but provider returned an empty list.
  // - `models === [...]` -> Searchable picker is available.
  // Discovery failure NEVER disables / clears / hides the Model field;
  // manual entry stays available regardless.
  const [models, setModels] = useState<ReadonlyArray<DiscoveredModel> | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const blurCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter against the typed value. Preserves provider order (no client
  // sort), case-insensitive substring match.
  const filter = model.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!models) return [];
    if (!filter) return models;
    return models.filter((m) => m.id.toLowerCase().includes(filter));
  }, [models, filter]);
  const visible = filtered.slice(0, MODEL_PICKER_VISIBLE_CAP);

  // Reset the picker highlight when the filter changes — without this,
  // moving past the end of a newly-shorter list would highlight nothing.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filter]);

  // Stale-result guard: when ANY discovery input changes after a model
  // list has been loaded (or a discovery error has surfaced), clear the
  // cached state so the operator never sees results that don't match
  // the currently-typed inputs. The Model field itself is NOT cleared —
  // manual entry must stay intact.
  useEffect(() => {
    if (models === null && discoveryError === null) return;
    setModels(null);
    setDiscoveryError(null);
    setPickerOpen(false);
    setHighlightedIndex(0);
    // Note: re-running discovery is the operator's call — we don't
    // auto-retry on input change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, envVar, allowLocalNetwork, preset.id]);

  // Cancel any pending blur-close on unmount so a tab-out followed by
  // immediate close doesn't fire setState on a stale component.
  useEffect(() => {
    return () => {
      if (blurCloseTimerRef.current) {
        clearTimeout(blurCloseTimerRef.current);
        blurCloseTimerRef.current = null;
      }
    };
  }, []);

  async function onLoadModels() {
    if (!canDiscover || discovering) return;
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const settings: Record<string, unknown> = {};
      if (baseUrl) settings.baseUrl = baseUrl;
      const result = await discoverModels({
        presetId: preset.id,
        ...(envVar.trim() ? { authRef: `env:${envVar.trim()}` } : {}),
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
        ...(allowLocalNetwork ? { allowLocalNetwork: true } : {}),
      });
      if (result.ok) {
        setModels(result.models);
        setPickerOpen(true);
        setHighlightedIndex(0);
        // Keep focus on the Model input so keyboard navigation works
        // immediately after Load models.
        modelInputRef.current?.focus();
      } else {
        // Discovery failure: surface the neutral message; do NOT clear,
        // disable, or hide the Model field. Manual entry stays available.
        setModels(null);
        setDiscoveryError(result.message);
        setPickerOpen(false);
      }
    } finally {
      setDiscovering(false);
    }
  }

  function onModelKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Escape and Enter need to run regardless of whether the visible
    // list is empty — otherwise an open picker with a zero-match
    // filter would leak Escape to the outer modal and let Enter
    // submit the Add Provider form.
    if (pickerOpen && e.key === "Escape") {
      // Locked behaviour (spec §11): Escape closes the picker, keeps
      // focus on the Model field, and does NOT clear the typed value.
      // stopPropagation prevents the outer modal from also closing.
      e.preventDefault();
      e.stopPropagation();
      setPickerOpen(false);
      return;
    }
    if (pickerOpen && e.key === "Enter") {
      // With matches: select the highlighted model. With zero matches:
      // swallow Enter so the form does not submit on an empty picker.
      const sel = visible[highlightedIndex];
      if (sel) {
        e.preventDefault();
        setModel(sel.id);
        setPickerOpen(false);
      } else {
        e.preventDefault();
      }
      return;
    }
    if (!pickerOpen || visible.length === 0) {
      // Arrow-key navigation does nothing when the picker is closed or
      // when the filter yields zero rows — the operator can keep
      // typing without interference.
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    }
  }

  function onModelBlur() {
    // SHOULD-FIX (PR #30 review): Tab out of the Model field should
    // close the picker. setTimeout(0) defers the close so a click on
    // a picker row (which keeps focus on the input via
    // onMouseDown.preventDefault) still registers before the close
    // fires. Cleared on the next focus event.
    if (blurCloseTimerRef.current) clearTimeout(blurCloseTimerRef.current);
    blurCloseTimerRef.current = setTimeout(() => {
      setPickerOpen(false);
      blurCloseTimerRef.current = null;
    }, 0);
  }

  function onModelFocus() {
    if (blurCloseTimerRef.current) {
      clearTimeout(blurCloseTimerRef.current);
      blurCloseTimerRef.current = null;
    }
    if (models) setPickerOpen(true);
  }

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
                    rel="noopener noreferrer"
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
        <Field
          label="Model"
          hint={
            canDiscover
              ? "Type a model id manually, or click Load models to pick from the provider's catalog. Discovery failures never disable this field."
              : undefined
          }
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-stretch gap-2">
              <input
                ref={modelInputRef}
                className="flex-1 bg-transparent border rounded-md px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-[color:var(--panel-border-hot)]"
                style={{ borderColor: "var(--panel-border)" }}
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  if (models) setPickerOpen(true);
                }}
                onFocus={onModelFocus}
                onBlur={onModelBlur}
                onKeyDown={onModelKeyDown}
                role="combobox"
                aria-autocomplete="list"
                // aria-controls always points to a real element when
                // expanded: ModelPicker renders a stable container with
                // id="model-picker" and role="listbox" even in its empty
                // state, so this reference is never dangling.
                aria-controls={pickerOpen ? "model-picker" : undefined}
                aria-expanded={pickerOpen}
              />
              {canDiscover && (
                <button
                  type="button"
                  className="px-3 py-1.5 text-[12px] border rounded-md hover:opacity-80 disabled:opacity-50 whitespace-nowrap"
                  style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}
                  onClick={onLoadModels}
                  disabled={discovering}
                >
                  {discovering ? "Loading…" : "Load models"}
                </button>
              )}
            </div>
            {discoveryError && (
              <p className="text-[12px]" style={{ color: "#fbbf24" }}>
                {discoveryError}{" "}
                <span className="text-[var(--fg-dimmer)]">
                  — enter a model id manually.
                </span>
              </p>
            )}
            {pickerOpen && models !== null && (
              <ModelPicker
                listId="model-picker"
                visible={visible}
                totalMatches={filtered.length}
                highlightedIndex={highlightedIndex}
                onHover={setHighlightedIndex}
                onSelect={(id) => {
                  setModel(id);
                  setPickerOpen(false);
                }}
                emptyState={
                  models.length === 0
                    ? "Provider returned no models — enter a model id manually."
                    : `No matches for “${model}” — keep typing or enter a model id manually.`
                }
              />
            )}
          </div>
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

      {/*
        Three close-related buttons used to live in this modal:
          - Close   (header)      — exits the modal entirely.
          - ← Back  (header)      — returns to the preset picker step.
          - Cancel  (here, removed) — pointed at `onBack` and did the
                                     same thing as ← Back, just at the
                                     bottom of the form.

        The Cancel button promised "abandon the whole add-provider
        flow" (the conventional reading of a bottom-row Cancel paired
        with a primary Add) while actually duplicating ← Back's
        previous-step behaviour. Dropped. Three buttons → two buttons
        (← Back top-left, Close top-right) each with one distinct
        meaning. Operators abandoning the flow use Close; operators
        wanting a different preset use ← Back.
      */}
      <div className="flex items-center justify-end gap-2 pt-2">
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

// Note: the previous "Step 3 — result" AddResult component (a result
// screen with Close + Done buttons after a successful add) has been
// removed. The modal now auto-closes after a successful add and the
// new connector's testConnection result surfaces on the row itself in
// ConnectorsPanel via the same ValidationBadge the Test button uses.
// See the comment on AddProviderFlowProps at the top of this file for
// the full rationale. Do NOT reintroduce a third step.
