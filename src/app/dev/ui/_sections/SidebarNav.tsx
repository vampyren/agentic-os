// /dev/ui §4.1 — Sidebar navigation items (M4a-FU6 PR B + amend / Rex review #2).
//
// CANONICAL TARGET — see FU6 spec §3.2 and UI-GUIDELINES.md §5.3.
// Production already renders this shape via src/components/Sidebar.tsx;
// the demo here hand-mirrors the visual essence so /dev/ui stays
// server-rendered (the production NavLink + AgentAvatar are client
// components; importing them would cascade /dev/ui to client).
//
// PR B amend review #2:
//   - Agent nav items now carry the SAME canonical agent
//     icon/avatar treatment as the real sidebar/chat — a 32×32 tile
//     with a per-agent accent-gradient background and the agent's
//     INITIAL rendered in white. This hand-mirrors the first-letter-
//     fallback variant of `src/components/AgentAvatar.tsx` (the
//     `KNOWN` brand-glyph variant for Claude Code / Hermes / etc.
//     uses Lucide-equivalent custom SVGs in production; the
//     first-letter shape is the canonical "unknown agent" treatment
//     and reads correctly on /dev/ui as a server component).
//   - Right-side status dot stays SEPARATE from the avatar — the
//     avatar IS the agent identity; the dot IS the live signal.
//   - Module (non-agent) icons live inside a 32×32 neutral tile so
//     they carry the same visual weight as the agent avatars
//     (matches production Sidebar.tsx).

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
      fileOfRecord="src/components/Sidebar.tsx + src/components/AgentAvatar.tsx"
      kind="hand-mirror"
    >
      <StateRow label="default" note="module nav item; lucide icon in a 32×32 neutral tile">
        <DemoModuleNavItem icon={<LayoutGrid size={16} strokeWidth={1.6} />} label="Mission Control" />
      </StateRow>

      <StateRow label="hover" note="bg shifts to --bg-elevated-hot; border to --panel-border-hot">
        <DemoModuleNavItem icon={<SettingsIcon size={16} strokeWidth={1.6} />} label="Settings" hovered />
      </StateRow>

      <StateRow label="selected / active" note="filled bg + brighter border + 2px accent left edge — unmissable">
        <DemoModuleNavItem icon={<Target size={16} strokeWidth={1.6} />} label="Agents" active accent="var(--accent-claude-code)" />
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-3 pb-1">
        Agent nav items — canonical avatar treatment
      </header>

      <StateRow
        label="agent — live"
        note="32×32 accent-gradient tile with the agent initial. Same shape as src/components/AgentAvatar.tsx first-letter fallback. Right-side status dot is SEPARATE from the avatar."
      >
        <DemoAgentNavItem
          name="Claude Code"
          initial="C"
          accent="var(--accent-claude-code)"
          agentTone="live"
        />
      </StateRow>

      <StateRow label="agent — degraded" note="--status-degraded dot on the right; avatar unchanged">
        <DemoAgentNavItem
          name="Hermes"
          initial="H"
          accent="var(--accent-hermes)"
          agentTone="degraded"
        />
      </StateRow>

      <StateRow label="agent — offline" note="--status-offline dot on the right">
        <DemoAgentNavItem
          name="OpenClaw"
          initial="O"
          accent="var(--accent-openclaw)"
          agentTone="offline"
        />
      </StateRow>

      <StateRow label="agent — unknown" note="--status-unknown (grey — silent, no alarm)">
        <DemoAgentNavItem
          name="ChatGPT"
          initial="G"
          accent="var(--accent-chatgpt)"
          agentTone="unknown"
        />
      </StateRow>

      <StateRow label="agent — active" note="avatar gradient brightens; same 2px accent left edge as module items">
        <DemoAgentNavItem
          name="Claude Code"
          initial="C"
          accent="var(--accent-claude-code)"
          agentTone="live"
          active
        />
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-3 pb-1">
        Self section — module shape (3 items)
      </header>

      <StateRow label="group label" note="non-interactive sub-header; no surface treatment">
        <div className="px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)]">
            Self
          </span>
        </div>
      </StateRow>

      <StateRow label="self items" note="Goals / Journal / Memory — module-shape rows">
        <div className="flex flex-col gap-1.5 w-[260px]">
          <DemoModuleNavItem icon={<Target size={16} strokeWidth={1.6} />} label="Goals" />
          <DemoModuleNavItem icon={<BookOpen size={16} strokeWidth={1.6} />} label="Journal" />
          <DemoModuleNavItem icon={<Brain size={16} strokeWidth={1.6} />} label="Memory" />
        </div>
      </StateRow>

      <StateRow label="disabled" note="future / feature-flagged route; dimmed, no hover, aria-disabled">
        <DemoModuleNavItem icon={<Clock size={16} strokeWidth={1.6} />} label="Scheduler" disabled />
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

// ── Module nav item (Mission Control / Settings / Goals / etc.) ──────
//
// Hand-mirror of production Sidebar.tsx NavLink (module variant): a
// 32×32 lucide-icon tile + label. The tile carries the active tint
// and the accent left-edge.

function DemoModuleNavItem({
  icon,
  label,
  accent = "var(--fg)",
  hovered = false,
  active = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  accent?: string;
  hovered?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  const isHot = hovered || active;
  return (
    <div
      aria-disabled={disabled || undefined}
      className="inline-flex items-center gap-3 px-3 py-2 rounded-md border w-[260px] relative"
      style={{
        borderColor: isHot ? "var(--panel-border-hot)" : "var(--panel-border)",
        background: isHot ? "var(--bg-elevated-hot)" : "var(--bg-elevated)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
          style={{ background: accent }}
        />
      )}
      <span
        aria-hidden
        className="shrink-0 grid place-items-center w-8 h-8 rounded-lg"
        style={{
          background: active ? "rgba(255,255,255,0.05)" : "transparent",
          color: active ? accent : "var(--fg-dim)",
        }}
      >
        {icon}
      </span>
      <span
        className="text-[13px] font-medium flex-1 min-w-0 truncate"
        style={{ color: active ? "var(--fg)" : "var(--fg-dim)" }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Agent nav item ─────────────────────────────────────────────────
//
// Hand-mirror of production Sidebar.tsx NavLink (agent variant) +
// AgentAvatar.tsx first-letter fallback. Avatar IS the icon tile;
// status dot lives on the far right, separate from agent identity.

function DemoAgentNavItem({
  name,
  initial,
  accent,
  agentTone,
  active = false,
}: {
  name: string;
  initial: string;
  accent: string;
  agentTone: "live" | "degraded" | "offline" | "unknown";
  active?: boolean;
}) {
  const toneColor =
    agentTone === "live"
      ? "var(--status-live)"
      : agentTone === "degraded"
      ? "var(--status-degraded)"
      : agentTone === "offline"
      ? "var(--status-offline)"
      : "var(--status-unknown)";

  return (
    <div
      className="inline-flex items-center gap-3 px-3 py-2 rounded-md border w-[260px] relative"
      style={{
        borderColor: active ? "var(--panel-border-hot)" : "var(--panel-border)",
        background: active ? "var(--bg-elevated-hot)" : "var(--bg-elevated)",
      }}
      aria-label={name}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
          style={{ background: accent }}
        />
      )}
      <AgentAvatarMirror name={name} initial={initial} accent={accent} active={active} />
      <span
        className="text-[13px] font-medium flex-1 min-w-0 truncate"
        style={{ color: active ? "var(--fg)" : "var(--fg-dim)" }}
      >
        {name}
      </span>
      <span
        aria-label={`agent ${agentTone}`}
        title={`agent ${agentTone}`}
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: toneColor, boxShadow: `0 0 6px ${toneColor}` }}
      />
    </div>
  );
}

// ── Agent avatar mirror ────────────────────────────────────────────
//
// Hand-mirror of AgentAvatar's first-letter fallback shape:
// circular tile, accent-gradient background, white-ish initial,
// inner highlight ring, outer accent glow when active. Used here to
// keep /dev/ui as a server component without pulling in framer-motion.

function AgentAvatarMirror({
  name,
  initial,
  accent,
  active,
}: {
  name: string;
  initial: string;
  accent: string;
  active: boolean;
}) {
  return (
    <span
      aria-label={`avatar ${name}`}
      className="shrink-0 grid place-items-center w-8 h-8 rounded-full relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 95%, white 25%), ${accent})`,
        boxShadow: active
          ? `0 0 16px -4px ${accent}, inset 0 0 0 1px rgba(255,255,255,0.18)`
          : `inset 0 0 0 1px rgba(255,255,255,0.12)`,
      }}
    >
      <span
        className="text-[12px] font-semibold tracking-tight"
        style={{ color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
      >
        {initial}
      </span>
    </span>
  );
}
