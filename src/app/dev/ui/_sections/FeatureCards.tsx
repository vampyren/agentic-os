// /dev/ui §4.4 — Feature dashboard cards (M4a-FU6 PR B).
//
// Hand-mirror of the feature-card shape from src/app/page.tsx (the
// Scheduler card and similar compact cards on Mission Control's
// dashboard). Uses the same --status-* Mission Control token family
// as §4.2 — no parallel "feature-status" token set.
//
// Mock data only — no `gateFeatureApi` call, no real feature
// projection.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function FeatureCardsSection() {
  return (
    <Section
      anchor="feature-cards"
      number="4.4"
      title="Feature dashboard cards"
      fileOfRecord="src/app/page.tsx + feature-card components"
      kind="hand-mirror"
    >
      <StateRow label="Scheduler card" note="big-card pattern; status dot + label + sub-label">
        <DemoFeatureCard
          variant="big"
          title="Scheduler"
          subtitle="3 missions scheduled · next fires in 18m"
          tone="live"
        />
      </StateRow>

      <StateRow label="compact feature card" note="narrower variant for grid layouts">
        <DemoFeatureCard
          variant="compact"
          title="Vault index"
          subtitle="2 471 notes · last build 4m ago"
          tone="live"
        />
      </StateRow>

      <StateRow label="degraded" note="amber dot; non-failure caution">
        <DemoFeatureCard
          variant="compact"
          title="Connectors"
          subtitle="2 of 3 healthy"
          tone="degraded"
        />
      </StateRow>

      <StateRow label="disabled / soon" note="dim text; gateFeatureApi reports off; NOT offline color">
        <DemoFeatureCard
          variant="compact"
          title="Approvals"
          subtitle="soon · M5"
          tone="soon"
        />
      </StateRow>
    </Section>
  );
}

function DemoFeatureCard({
  variant,
  title,
  subtitle,
  tone,
}: {
  variant: "big" | "compact";
  title: string;
  subtitle: string;
  tone: "live" | "degraded" | "offline" | "soon" | "unknown";
}) {
  const isSoon = tone === "soon";
  const toneColor = isSoon
    ? "var(--fg-dimmer)"
    : tone === "live"
    ? "var(--status-live)"
    : tone === "degraded"
    ? "var(--status-degraded)"
    : tone === "offline"
    ? "var(--status-offline)"
    : "var(--status-unknown)";

  const width = variant === "big" ? "w-[340px]" : "w-[220px]";
  const padding = variant === "big" ? "p-6" : "p-4";
  const titleSize = variant === "big" ? "text-[16px]" : "text-[13px]";

  return (
    <div
      className={`panel ${padding} ${width} flex flex-col gap-1`}
      style={{
        borderColor: "var(--panel-border)",
        opacity: isSoon ? 0.6 : 1,
      }}
    >
      <div className="flex items-center justify-between">
        <span className={`${titleSize} font-medium`} style={{ color: isSoon ? "var(--fg-dim)" : "var(--fg)" }}>
          {title}
        </span>
        <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: toneColor }} />
      </div>
      <p className="text-[11px] text-[var(--fg-dim)]">{subtitle}</p>
    </div>
  );
}
