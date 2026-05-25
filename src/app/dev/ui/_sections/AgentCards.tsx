// /dev/ui §4.3 — Agent cards (M4a-FU6 PR B).
//
// Hand-mirror of the AgentPortal shape from
// src/components/AgentPortal.tsx. AgentPortal uses framer-motion
// (client component) and is structured for a vitals-fetch lifecycle;
// hand-mirroring keeps /dev/ui as server-rendered with no runtime
// dependencies on framer-motion or live data.
//
// Tokens used: --panel / --panel-border / --panel-border-hot (card
// surface + hover border); --accent-* per-agent; status colors from
// the Mission Control family (--status-live for "ONLINE", etc.).

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function AgentCardsSection() {
  return (
    <Section
      anchor="agent-cards"
      number="4.3"
      title="Agent cards"
      fileOfRecord="src/components/AgentPortal.tsx / AgentRoom.tsx / src/app/agents/page.tsx"
    >
      <StateRow label="normal" note="idle card; subtle border">
        <DemoAgentCard
          name="Claude Code"
          tagline="general-purpose code agent"
          accent="var(--accent-claude-code)"
          status="ok"
        />
      </StateRow>

      <StateRow label="hover" note="1px lift + border-opacity bump">
        <DemoAgentCard
          name="Hermes"
          tagline="kanban + journaling"
          accent="var(--accent-hermes)"
          status="ok"
          hovered
        />
      </StateRow>

      <StateRow label="degraded" note="amber status label; metrics still visible">
        <DemoAgentCard
          name="OpenClaw"
          tagline="OpenAI-compatible LLM router"
          accent="var(--accent-openclaw)"
          status="warn"
        />
      </StateRow>

      <StateRow label="offline" note="rose status label">
        <DemoAgentCard
          name="ChatGPT"
          tagline="OpenAI direct"
          accent="var(--accent-chatgpt)"
          status="err"
        />
      </StateRow>

      <StateRow label="with metric boxes" note="memory / cpu / token-spend tiles">
        <DemoAgentCard
          name="Hermes"
          tagline="kanban + journaling"
          accent="var(--accent-hermes)"
          status="ok"
          metrics={[
            { label: "Mem", value: "1.2 GB" },
            { label: "CPU", value: "8%" },
            { label: "Tokens", value: "12.4k" },
          ]}
        />
      </StateRow>
    </Section>
  );
}

function DemoAgentCard({
  name,
  tagline,
  accent,
  status,
  hovered = false,
  metrics,
}: {
  name: string;
  tagline: string;
  accent: string;
  status: "ok" | "warn" | "err" | "unknown";
  hovered?: boolean;
  metrics?: ReadonlyArray<{ label: string; value: string }>;
}) {
  const statusLabel =
    status === "ok" ? "ONLINE" : status === "warn" ? "DEGRADED" : status === "err" ? "OFFLINE" : "UNKNOWN";
  const statusColor =
    status === "ok"
      ? "var(--status-live)"
      : status === "warn"
      ? "var(--status-degraded)"
      : status === "err"
      ? "var(--status-offline)"
      : "var(--status-unknown)";

  return (
    <div
      className={
        "panel p-4 relative overflow-hidden w-[320px] flex flex-col gap-3"
        + (hovered ? " -translate-y-[1px]" : "")
      }
      style={{
        borderColor: hovered ? "var(--panel-border-hot)" : "var(--panel-border)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-20"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
            <span className="text-[14px] font-medium truncate">{name}</span>
          </div>
          <p className="text-[12px] text-[var(--fg-dim)] mt-0.5 truncate">{tagline}</p>
        </div>
        <span
          className="text-[10px] uppercase tracking-wider shrink-0"
          style={{ color: statusColor }}
        >
          {statusLabel}
        </span>
      </div>
      {metrics && (
        <div className="grid grid-cols-3 gap-2 mt-1">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <div className="text-[9px] uppercase tracking-wider text-[var(--fg-dimmer)]">
                {m.label}
              </div>
              <div className="text-[13px] font-medium">{m.value}</div>
            </div>
          ))}
        </div>
      )}
      <span className="text-[11px] text-[var(--fg-dimmer)] mt-1">
        → Open workspace
      </span>
    </div>
  );
}
