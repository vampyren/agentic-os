// /dev/ui §4.5 — Self cards (M4a-FU6 PR B).
//
// Hand-mirror of the SelfCard shape from src/components/SelfCard.tsx.
// The production SelfCard uses framer-motion + next/link, both of
// which would make /dev/ui a client component if imported. The
// visual essence is reproducible with Tailwind alone; hand-mirror
// keeps the section server-rendered.
//
// Tokens used: --panel / --panel-border (surface); --fg / --fg-dim
// (text); per-Self accents (--accent-default fallback, plus
// per-surface accents like teal/violet/indigo).

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

// Self-card accent fixtures. Production currently sources these as
// inline hex inside src/app/{goals,journal,memory}/page.tsx — they
// are NOT yet in `globals.css :root`. Documenting them in a named
// constant here makes the /dev/ui examples deliberate (not
// scattered hex) and gives a future hardening pass a single place
// to read from when extracting --self-* tokens into the global
// vocabulary. That extraction is out of scope for FU6 (per the
// FU6 spec §1.2 — additive only; tokens land when M4a-6a or
// another consumer demands them).
//
// Memory's teal happens to match --accent-hermes (#22d3ee); kept
// here as a Self-card-specific reference so a future palette
// change to either family doesn't accidentally bleed across.
const SELF_ACCENT = {
  goals: "#a78bfa",
  journal: "#fbbf24",
  memory: "#22d3ee",
} as const;

export default function SelfCardsSection() {
  return (
    <Section
      anchor="self-cards"
      number="4.5"
      title="Self cards"
      fileOfRecord="src/components/SelfCard.tsx + src/app/{goals,journal,memory}/page.tsx"
      kind="hand-mirror"
    >
      <StateRow label="Goals" note="violet accent + bottom-right halo">
        <DemoSelfCard
          title="Goals"
          tagline="What I'm working towards"
          accent={SELF_ACCENT.goals}
          stat="3 active · 1 due this week"
        />
      </StateRow>

      <StateRow label="Journal" note="amber accent">
        <DemoSelfCard
          title="Journal"
          tagline="What I noticed today"
          accent={SELF_ACCENT.journal}
          stat="last entry 2h ago"
        />
      </StateRow>

      <StateRow label="Memory" note="teal accent">
        <DemoSelfCard
          title="Memory"
          tagline="What persists across sessions"
          accent={SELF_ACCENT.memory}
          stat="142 entries · 4 surfaced this week"
        />
      </StateRow>

      <StateRow label="hover" note="1px lift + halo opacity bump">
        <DemoSelfCard
          title="Goals"
          tagline="What I'm working towards"
          accent={SELF_ACCENT.goals}
          stat="3 active · 1 due this week"
          hovered
        />
      </StateRow>
    </Section>
  );
}

function DemoSelfCard({
  title,
  tagline,
  accent,
  stat,
  hovered = false,
}: {
  title: string;
  tagline: string;
  accent: string;
  stat: string;
  hovered?: boolean;
}) {
  return (
    <div
      className={
        "panel p-5 relative overflow-hidden w-[320px] flex flex-col gap-2"
        + (hovered ? " -translate-y-[1px]" : "")
      }
      style={{
        borderColor: hovered ? "var(--panel-border-hot)" : "var(--panel-border)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-12 w-48 h-48 rounded-full blur-3xl"
        style={{ background: accent, opacity: hovered ? 0.5 : 0.25 }}
      />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
            <span className="text-[14px] font-medium">{title}</span>
          </div>
          <p className="text-[12px] text-[var(--fg-dim)] mt-0.5">{tagline}</p>
        </div>
        <span className="text-[11px] text-[var(--fg-dimmer)]">↗</span>
      </div>
      <p className="text-[11px] text-[var(--fg-dim)] mt-2">{stat}</p>
    </div>
  );
}
