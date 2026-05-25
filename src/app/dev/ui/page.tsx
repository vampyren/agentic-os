// /dev/ui — internal design-system reference (M4a-FU6 PR B).
//
// Per the FU6 task spec
// (docs/specs/expandability-foundation/m4a-fu6-task-spec.md):
//
//   - PR A landed the additive skeleton (route + placeholders +
//     UI-GUIDELINES.md draft + NEW token block in globals.css).
//   - PR B (this commit) fills each §4 category with LIVE React
//     component examples. Sections live under
//     src/app/dev/ui/_sections/ so the composer stays a thin
//     index.
//   - PR C will swap inline color hex in existing components for
//     the new tokens. PR D ships the closeout
//     (docs/M4AFU6-ACCEPTANCE.md, ROADMAP, spec status →
//     CODE COMPLETE, ARCHITECTURE paragraph).
//
// Import strategy (per the FU6 spec §3.2 + this PR's hard limits):
//
//   - WHERE PRACTICAL: import directly from production source paths
//     (e.g. src/components/Pill.tsx, exported as default).
//   - WHERE INLINE-ONLY: hand-mirror the JSX in this directory.
//     Production components like ConnectorsPanel.StatusPill /
//     ConnectorRow / ValidationDetail and AddProviderFlow's
//     Field / modal pieces are NOT exported. Refactoring those
//     files to export them is OUT OF SCOPE for PR B (hard limit:
//     no existing component refactors). Each hand-mirror carries
//     a `// HAND-MIRROR — source: …` comment naming its origin.
//
// Data safety (§3.4 / §9 non-leak):
//
//   - This page calls NO API routes. No /api/connectors, no
//     /api/vitals, no /api/runs, no /api/scheduler/status.
//   - All connector / agent / preset names + URLs + env var
//     references in the example sections are fixture-only.
//   - The preview-only API-key field renders `••••••••` with a
//     no-op onChange and the "preview only — M4a-6b" caption.
//
// The route is reachable at http://127.0.0.1:3000/dev/ui but is NOT
// linked from the operator sidebar (O2 / O5). Type the URL.

import type { ReactNode } from "react";
import SidebarNavSection from "./_sections/SidebarNav";
import MissionControlCardsSection from "./_sections/MissionControlCards";
import AgentCardsSection from "./_sections/AgentCards";
import FeatureCardsSection from "./_sections/FeatureCards";
import SelfCardsSection from "./_sections/SelfCardsSection";
import SettingsLayoutSection from "./_sections/SettingsLayout";
import ConnectorRowsSection from "./_sections/ConnectorRows";
import StatusPillsSection from "./_sections/StatusPills";
import TrustBadgesSection from "./_sections/TrustBadges";
import FormFieldsSection from "./_sections/FormFields";
import ModalsSection from "./_sections/Modals";
import LoadingStatesSection from "./_sections/LoadingStates";
import InteractionStatesSection from "./_sections/InteractionStates";
import AutoCloseHighlightSection from "./_sections/AutoCloseHighlight";

export const dynamic = "force-static";

export const metadata = {
  title: "Agentic OS — /dev/ui (design-system reference)",
  description:
    "Internal design-system reference. Not an operator surface.",
};

export default function DevUiPage(): ReactNode {
  return (
    <main className="flex-1 min-w-0 flex flex-col gap-6 p-6">
      <Header />
      <DataSafetyBanner />
      <ReducedMotionTip />
      <ul className="flex flex-col gap-4">
        <SidebarNavSection />
        <MissionControlCardsSection />
        <AgentCardsSection />
        <FeatureCardsSection />
        <SelfCardsSection />
        <SettingsLayoutSection />
        <ConnectorRowsSection />
        <StatusPillsSection />
        <TrustBadgesSection />
        <FormFieldsSection />
        <ModalsSection />
        <LoadingStatesSection />
        <InteractionStatesSection />
        <AutoCloseHighlightSection />
      </ul>
      <Footer />
    </main>
  );
}

function Header(): ReactNode {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-medium tracking-tight">
        /dev/ui — design-system reference
      </h1>
      <p className="text-[13px] text-[var(--fg-dim)]">
        Internal visual reference. <strong>NOT an operator surface.</strong>{" "}
        Every example below uses mock / demo data. The written rules
        companion lives at <code>docs/UI-GUIDELINES.md</code> and
        links into the anchors on this page.
      </p>
    </header>
  );
}

function DataSafetyBanner(): ReactNode {
  return (
    <section
      className="panel p-3 text-[12px] text-[var(--fg-dim)]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <strong className="text-[var(--fg)]">Data safety:</strong>{" "}
      this page renders mock / demo data only. No live provider data,
      no secrets, no env var values, no baseUrl values, no raw fetch
      errors. API-key example fields are preview-only fake
      placeholders; the real <code>SecretField</code> is M4a-6b scope.
      The page calls NO API routes.
    </section>
  );
}

function ReducedMotionTip(): ReactNode {
  return (
    <section
      className="panel p-3 text-[12px] text-[var(--fg-dim)]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <strong className="text-[var(--fg)]">Reduced-motion verification:</strong>{" "}
      to verify the pulse / highlight downgrades on this page, open
      browser devtools → Rendering panel → Emulate CSS media feature
      → <code>prefers-reduced-motion: reduce</code>. Animations should
      drop to static states. §4.13 and §4.14 demonstrate the
      downgrade explicitly.
    </section>
  );
}

function Footer(): ReactNode {
  return (
    <footer className="text-[11px] text-[var(--fg-dimmer)] mt-4">
      M4a-FU6 PR B — live component inventory. Spec:{" "}
      <code>docs/specs/expandability-foundation/m4a-fu6-task-spec.md</code>.
      Written rules: <code>docs/UI-GUIDELINES.md</code>.
    </footer>
  );
}
