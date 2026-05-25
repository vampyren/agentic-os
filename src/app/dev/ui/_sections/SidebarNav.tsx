// /dev/ui §4.1 — Sidebar navigation items (M4a-FU6 PR B + amend).
//
// Hand-mirror of the NavLink + GroupLabel shapes from
// src/components/Sidebar.tsx. NavLink + GroupLabel are internal to
// that file (not exported); refactoring Sidebar.tsx to export them
// is out of scope for PR B (no existing component refactors).
//
// PR B amend (visual polish):
//   - Use the SAME lucide-react icon set the real sidebar uses
//     (LayoutGrid for Mission Control, Settings for Settings, etc.)
//     so /dev/ui resembles the actual sidebar.
//   - Nav items render on a subtle elevated surface so they feel
//     like polished pill-buttons, not flat text. Selected state is
//     clearly distinct from hover (filled bg-elevated-hot + brighter
//     border).
//   - The Settings-style edged item stays — that's the canonical
//     active-route look we want everywhere.

import {
  LayoutGrid,
  Target,
  BookOpen,
  Brain,
  Settings as SettingsIcon,
  Clock,
} from "lucide-react";
import type { ReactNode } from "react";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function SidebarNavSection() {
  return (
    <Section
      anchor="sidebar-nav"
      number="4.1"
      title="Sidebar navigation items"
      fileOfRecord="src/components/Sidebar.tsx"
    >
      <StateRow label="default" note="idle item; subtle elevated surface so it reads as a button, not flat text">
        <DemoNavItem icon={<LayoutGrid size={14} />} label="Mission Control" />
      </StateRow>

      <StateRow label="hover" note="bg shifts to --bg-elevated-hot; border to --panel-border-hot">
        <DemoNavItem icon={<SettingsIcon size={14} />} label="Settings" hovered />
      </StateRow>

      <StateRow label="selected / active" note="filled bg + brighter border + accent left edge — unmissable">
        <DemoNavItem icon={<Target size={14} />} label="Agents" active />
      </StateRow>

      <StateRow label="agent — live" note="--status-live dot on the right (small, glance-readable)">
        <DemoNavItem
          icon={<AgentChip accent="var(--accent-claude-code)" />}
          label="Claude Code"
          agentTone="live"
        />
      </StateRow>

      <StateRow label="agent — degraded" note="--status-degraded (amber)">
        <DemoNavItem
          icon={<AgentChip accent="var(--accent-hermes)" />}
          label="Hermes"
          agentTone="degraded"
        />
      </StateRow>

      <StateRow label="agent — offline" note="--status-offline (rose)">
        <DemoNavItem
          icon={<AgentChip accent="var(--accent-openclaw)" />}
          label="OpenClaw"
          agentTone="offline"
        />
      </StateRow>

      <StateRow label="agent — unknown" note="--status-unknown (GREY — silent, no alarm)">
        <DemoNavItem
          icon={<AgentChip accent="var(--accent-chatgpt)" />}
          label="ChatGPT"
          agentTone="unknown"
        />
      </StateRow>

      <StateRow label="group label" note="non-interactive sub-header; spaced caps; no surface treatment">
        <div className="px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)]">
            Self
          </span>
        </div>
      </StateRow>

      <StateRow label="self items" note="Goals / Journal / Memory — same NavLink shape">
        <div className="flex flex-col gap-1.5 w-[240px]">
          <DemoNavItem icon={<Target size={14} />} label="Goals" />
          <DemoNavItem icon={<BookOpen size={14} />} label="Journal" />
          <DemoNavItem icon={<Brain size={14} />} label="Memory" />
        </div>
      </StateRow>

      <StateRow label="disabled" note="future / feature-flagged route; dimmed, no hover, aria-disabled">
        <DemoNavItem icon={<Clock size={14} />} label="Scheduler" disabled />
      </StateRow>

      <StateRow label="footer / version" note="version pill only — settled UI shell decision">
        <div
          className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)] px-2 py-1 rounded-md border w-fit"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--bg-elevated)",
          }}
        >
          v0.3.0
        </div>
      </StateRow>
    </Section>
  );
}

/** Hand-mirror of the NavLink shape from src/components/Sidebar.tsx.
 *  Renders an idle / hover / active / disabled nav item with a
 *  subtle raised surface so it visually feels like a button. */
function DemoNavItem({
  icon,
  label,
  hovered = false,
  active = false,
  disabled = false,
  agentTone,
}: {
  icon: ReactNode;
  label: string;
  hovered?: boolean;
  active?: boolean;
  disabled?: boolean;
  agentTone?: "live" | "degraded" | "offline" | "unknown";
}) {
  const isHot = hovered || active;
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
      className="inline-flex items-center gap-2.5 px-3 py-2 rounded-md border w-[240px] relative"
      style={{
        borderColor: active
          ? "var(--panel-border-hot)"
          : isHot
          ? "var(--panel-border-hot)"
          : "var(--panel-border)",
        background: active
          ? "var(--bg-elevated-hot)"
          : isHot
          ? "var(--bg-elevated-hot)"
          : "var(--bg-elevated)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {/* Accent left-edge appears only on the active state — strongest
          cue that "this is the current route." */}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
          style={{ background: "var(--fg)" }}
        />
      )}
      <span
        className="shrink-0 inline-flex"
        style={{ color: active ? "var(--fg)" : "var(--fg-dim)" }}
      >
        {icon}
      </span>
      <span
        className="text-[13px] flex-1 min-w-0 truncate"
        style={{ color: active ? "var(--fg)" : "var(--fg-dim)" }}
      >
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

/** Per-agent accent chip used in place of the generic icon. Mirrors
 *  the production sidebar where each agent has its own accent dot. */
function AgentChip({ accent }: { accent: string }) {
  return (
    <span
      className="w-2.5 h-2.5 rounded-full"
      style={{ background: accent }}
      aria-hidden
    />
  );
}
