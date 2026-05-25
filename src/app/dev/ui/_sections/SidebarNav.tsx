// /dev/ui §4.1 — Sidebar navigation items (M4a-FU6 PR B).
//
// Hand-mirror of the NavLink + GroupLabel shapes from
// src/components/Sidebar.tsx. Imports are NOT possible — Sidebar.tsx
// only exports the default <Sidebar/> component; NavLink + GroupLabel
// are internal. Refactoring Sidebar.tsx to export them is OUT OF SCOPE
// for PR B (no existing component refactors); hand-mirror keeps the
// shape visually equivalent.
//
// Tokens used: --fg / --fg-dim / --fg-dimmer (text); --panel /
// --panel-border / --panel-border-hot (surfaces); --status-live etc.
// (agent dots, when an agent has a live signal).
//
// Mock data only — no live `/api/vitals` fetch. Demo agents are
// fixture-only.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function SidebarNavSection() {
  return (
    <Section
      anchor="sidebar-nav"
      number="4.1"
      title="Sidebar navigation items"
      fileOfRecord="src/components/Sidebar.tsx"
    >
      <StateRow label="default">
        <DemoNavItem label="Mission Control" accent="#94a3b8" />
      </StateRow>

      <StateRow label="hover" note="border-opacity bump on hover">
        <DemoNavItem label="Settings" accent="#94a3b8" hovered />
      </StateRow>

      <StateRow label="selected / active" note="current route — distinct from hover">
        <DemoNavItem label="Agents" accent="#94a3b8" active />
      </StateRow>

      <StateRow label="agent — live" note="status dot uses --status-live (green)">
        <DemoNavItem label="Claude Code" accent="var(--accent-claude-code)" agentTone="live" />
      </StateRow>

      <StateRow label="agent — degraded" note="--status-degraded (amber)">
        <DemoNavItem label="Hermes" accent="var(--accent-hermes)" agentTone="degraded" />
      </StateRow>

      <StateRow label="agent — offline" note="--status-offline (rose)">
        <DemoNavItem label="OpenClaw" accent="var(--accent-openclaw)" agentTone="offline" />
      </StateRow>

      <StateRow label="agent — unknown" note="--status-unknown (grey — Mission Control 'no signal')">
        <DemoNavItem label="ChatGPT" accent="var(--accent-chatgpt)" agentTone="unknown" />
      </StateRow>

      <StateRow label="group label" note="non-interactive sub-header">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--fg-dimmer)] py-1">
          Operator
        </div>
      </StateRow>

      <StateRow label="disabled" note="future / behind-feature-flag nav item">
        <DemoNavItem label="Scheduler" accent="#94a3b8" disabled />
      </StateRow>

      <StateRow label="footer / version" note="version pill only">
        <div className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)] py-1 px-2 rounded border w-fit"
             style={{ borderColor: "var(--panel-border)" }}>
          v0.3.0
        </div>
      </StateRow>
    </Section>
  );
}

/** Hand-mirror of the NavLink shape from src/components/Sidebar.tsx.
 *  Renders a single nav item with the same visual structure (icon-
 *  pad + label + optional agent status dot) but as a non-interactive
 *  demo — no Link href, no usePathname, no React state. */
function DemoNavItem({
  label,
  accent,
  hovered = false,
  active = false,
  disabled = false,
  agentTone,
}: {
  label: string;
  accent: string;
  hovered?: boolean;
  active?: boolean;
  disabled?: boolean;
  agentTone?: "live" | "degraded" | "offline" | "unknown";
}) {
  // Border opacity matches Sidebar's hover/active states.
  const borderColor = active || hovered
    ? "var(--panel-border-hot)"
    : "var(--panel-border)";
  const opacity = disabled ? 0.4 : 1;
  const toneColor = agentTone
    ? agentTone === "live"
      ? "var(--status-live)"
      : agentTone === "degraded"
      ? "var(--status-degraded)"
      : agentTone === "offline"
      ? "var(--status-offline)"
      : "var(--status-unknown)"
    : null;

  return (
    <div
      aria-disabled={disabled || undefined}
      className="inline-flex items-center gap-3 px-3 py-2 rounded-md border w-[220px]"
      style={{
        borderColor,
        background: active ? "var(--bg-elevated-hot)" : "var(--bg-elevated)",
        opacity,
      }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: accent }}
      />
      <span className="text-[13px] flex-1 min-w-0 truncate"
            style={{ color: active ? "var(--fg)" : "var(--fg-dim)" }}>
        {label}
      </span>
      {toneColor && (
        <span
          aria-label={`agent ${agentTone}`}
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: toneColor }}
        />
      )}
    </div>
  );
}
