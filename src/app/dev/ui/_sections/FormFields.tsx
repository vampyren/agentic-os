// /dev/ui §4.10 — Form fields (M4a-FU6 PR B).
//
// Hand-mirror of the Field + input shapes from
// src/app/settings/_connectors/AddProviderFlow.tsx. Includes the
// preview-only API-key field demanded by issue #37 round-2 #2 —
// rendered with a fake `••••••••` placeholder + the explicit
// "preview only — M4a-6b" caption. NO real SecretField, NO submit
// handler, NO secret-store wiring.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function FormFieldsSection() {
  return (
    <Section
      anchor="form-fields"
      number="4.10"
      title="Form fields (incl. preview-only API key)"
      fileOfRecord="src/app/settings/_connectors/AddProviderFlow.tsx + future FU4 (#35)"
    >
      <StateRow label="text input — idle">
        <DemoField label="Connector id">
          <DemoTextInput placeholder="openai-live" />
        </DemoField>
      </StateRow>

      <StateRow label="text input — focused" note="visible focus ring">
        <DemoField label="Connector id">
          <DemoTextInput placeholder="openai-live" focused />
        </DemoField>
      </StateRow>

      <StateRow label="text input — disabled">
        <DemoField label="Connector id">
          <DemoTextInput placeholder="openai-live" disabled />
        </DemoField>
      </StateRow>

      <StateRow label="env var NAME input" note="pattern attribute restricts to AUTHREF regex">
        <DemoField label="Env var name" hint="Letters / digits / underscores. The NAME, not the value.">
          <DemoTextInput placeholder="OPENAI_API_KEY" />
        </DemoField>
      </StateRow>

      <StateRow
        label="API key (preview only)"
        note="PREVIEW ONLY — M4a-6b owns the real SecretField"
      >
        <DemoField
          label="API key"
          hint={
            <span>
              <strong className="text-[var(--fg-dim)]">preview only</strong> — full implementation belongs to M4a-6b
              (UI-managed connector secrets).
            </span>
          }
        >
          <DemoTextInput placeholder="••••••••" disabled />
        </DemoField>
      </StateRow>

      <StateRow label="checkbox — unchecked">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[var(--fg-dim)] cursor-default"
            disabled
            aria-disabled
          />
          Allow local network
        </label>
      </StateRow>

      <StateRow label="checkbox — checked">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[var(--fg)] cursor-default"
            defaultChecked
            disabled
            aria-disabled
          />
          Allow local network
        </label>
      </StateRow>

      <StateRow label="help text">
        <DemoField label="Base URL" hint="Provider's OpenAI-compatible endpoint. https:// only.">
          <DemoTextInput placeholder="https://example.test/v1" />
        </DemoField>
      </StateRow>

      <StateRow label="inline error" note="neutral message map (discoveryMessageFor-style); no raw provider response">
        <DemoField label="Base URL">
          <DemoTextInput placeholder="https://example.test/v1" />
          <span className="text-[12px] mt-1" style={{ color: "var(--status-invalid)" }}>
            Base URL is in a blocked local-network range. Enable "Allow local network" if intended.
          </span>
        </DemoField>
      </StateRow>
    </Section>
  );
}

/** Hand-mirror of AddProviderFlow.Field (lines 639+ of that file). */
function DemoField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] w-[320px]">
      <span className="text-[12px] uppercase tracking-wider text-[var(--fg-dimmer)]">
        {label}
      </span>
      {children}
      {hint && <span className="text-[12px] text-[var(--fg-dimmer)]">{hint}</span>}
    </label>
  );
}

function DemoTextInput({
  placeholder,
  focused = false,
  disabled = false,
}: {
  placeholder?: string;
  focused?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      disabled={disabled}
      readOnly
      aria-disabled={disabled || undefined}
      className="px-3 py-2 rounded-md border bg-transparent text-[13px] cursor-default outline-none"
      style={{
        borderColor: focused ? "var(--panel-border-hot)" : "var(--panel-border)",
        boxShadow: focused ? "0 0 0 2px rgba(255,255,255,0.04)" : "none",
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}
