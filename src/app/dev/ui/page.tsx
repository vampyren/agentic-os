// /dev/ui — internal design-system reference (M4a-FU6 PR A skeleton).
//
// Per the FU6 task spec
// (docs/specs/expandability-foundation/m4a-fu6-task-spec.md):
//
//   - PR A (this commit) ships an ADDITIVE SKELETON: route shell +
//     one placeholder section per §4 category + anchors that
//     docs/UI-GUIDELINES.md links into. NO live React component
//     examples in PR A; those land in PR B.
//   - PR B will replace each placeholder with the live state-matrix
//     render of the canonical component, imported from production
//     source paths (no hand-mirroring) and fed deterministic mock /
//     demo data only (§3.4 data-safety rule — no live provider data,
//     no secrets, no env var values, no baseUrl values, no raw
//     fetch errors).
//   - PR C will swap inline color hex in existing components for the
//     new tokens defined in globals.css.
//   - The route is reachable at http://127.0.0.1:3000/dev/ui but is
//     NOT linked from the operator sidebar (O2 / O5).
//
// This is a server component — static content, no client-side state,
// no API calls. The /dev/ui page MUST NOT call any API route
// (§3.4 / §9 non-leak rule).

import type { ReactNode } from "react";

export const dynamic = "force-static";

export const metadata = {
  title: "Agentic OS — /dev/ui (design-system reference)",
  description:
    "Internal design-system reference. Not an operator surface.",
};

/** The §4 category list from the FU6 task spec. Each entry becomes one
 *  placeholder section in PR A; PR B fills each with live React
 *  component examples. Anchor ids are stable so docs/UI-GUIDELINES.md
 *  can link directly to a section. */
const CATEGORIES: ReadonlyArray<{
  anchor: string;
  number: string;
  title: string;
  fileOfRecord: string;
}> = [
  { anchor: "sidebar-nav", number: "4.1", title: "Sidebar navigation items", fileOfRecord: "src/components/Sidebar.tsx" },
  { anchor: "mission-control-cards", number: "4.2", title: "Mission Control top status cards", fileOfRecord: "src/components/Vitals.tsx + src/app/page.tsx" },
  { anchor: "agent-cards", number: "4.3", title: "Agent cards", fileOfRecord: "src/components/AgentPortal.tsx / AgentRoom.tsx / src/app/agents/page.tsx" },
  { anchor: "feature-cards", number: "4.4", title: "Feature dashboard cards", fileOfRecord: "src/app/page.tsx + feature-card components" },
  { anchor: "self-cards", number: "4.5", title: "Self cards", fileOfRecord: "src/components/SelfCard.tsx + src/app/{goals,journal,memory}/page.tsx" },
  { anchor: "settings-layout", number: "4.6", title: "Settings layout", fileOfRecord: "src/app/settings/page.tsx" },
  { anchor: "connector-rows", number: "4.7", title: "Connector rows", fileOfRecord: "src/app/settings/_connectors/ConnectorsPanel.tsx" },
  { anchor: "status-pills", number: "4.8", title: "Status pills (canonical)", fileOfRecord: "src/components/Pill.tsx + StatusPill inline" },
  { anchor: "trust-badges", number: "4.9", title: "Trust badges", fileOfRecord: "src/app/settings/_connectors/ConnectorsPanel.tsx (TRUST_COLORS)" },
  { anchor: "form-fields", number: "4.10", title: "Form fields (incl. preview-only API key)", fileOfRecord: "AddProviderFlow.tsx + future FU4 (#35)" },
  { anchor: "modals", number: "4.11", title: "Modals", fileOfRecord: "AddProviderFlow.tsx" },
  { anchor: "loading-states", number: "4.12", title: "Loading / skeleton states", fileOfRecord: "various" },
  { anchor: "interaction-states", number: "4.13", title: "Interaction states (cross-cutting)", fileOfRecord: "every interactive primitive" },
  { anchor: "auto-close-highlight", number: "4.14", title: "Auto-close + highlight pattern", fileOfRecord: "ConnectorsPanel.onAdded (PR #34 pattern)" },
];

export default function DevUiPage(): ReactNode {
  return (
    <main className="flex-1 min-w-0 flex flex-col gap-6 p-6">
      <Header />
      <DataSafetyBanner />
      <TokenIntroNote />
      <ul className="flex flex-col gap-4">
        {CATEGORIES.map((c) => (
          <CategorySection key={c.anchor} {...c} />
        ))}
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
        Internal visual reference. Not an operator surface. Live
        component examples land in <strong>PR B</strong>; this
        skeleton (PR A) carries the section anchors that{" "}
        <code>docs/UI-GUIDELINES.md</code> links into.
      </p>
    </header>
  );
}

function DataSafetyBanner(): ReactNode {
  // FU6 spec §3.4 / §9 — /dev/ui MUST use mock/demo data only.
  // The banner is part of the page header so the operator / contributor
  // reading the route immediately sees the rule.
  return (
    <section
      className="panel p-3 text-[12px] text-[var(--fg-dim)]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <strong className="text-[var(--fg)]">Data safety:</strong>{" "}
      this page renders mock / demo data only. No live provider data,
      no secrets, no env var values, no baseUrl values, no raw fetch
      errors. API-key example fields (when they land in PR B) are
      preview-only fake placeholders; the real <code>SecretField</code>{" "}
      is M4a-6b scope.
    </section>
  );
}

function TokenIntroNote(): ReactNode {
  // Document where the new tokens live so a contributor inspecting the
  // /dev/ui page can find them. PR A adds the tokens to globals.css but
  // does NOT yet swap any consumer; that's PR C.
  return (
    <section
      className="panel p-3 text-[12px] text-[var(--fg-dim)]"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <strong className="text-[var(--fg)]">Tokens (added in PR A):</strong>{" "}
      the connector-test status discriminant
      (<code>--status-valid</code>, <code>--status-invalid</code>,{" "}
      <code>--status-unreachable</code>, <code>--status-misconfigured</code>,{" "}
      <code>--status-test-unknown</code>, <code>--status-not-tested</code>)
      and the trust badge family (<code>--trust-first-party</code>,{" "}
      <code>--trust-community</code>, <code>--trust-untrusted</code>,{" "}
      <code>--trust-unknown</code>) are defined in{" "}
      <code>src/app/globals.css</code>. They compile but are not yet
      consumed — PR C will swap inline hex in existing components.{" "}
      <code>--status-unknown</code> deliberately stays Mission Control
      grey (no silent recoloring of Vitals / AgentPortal).
    </section>
  );
}

function CategorySection({
  anchor,
  number,
  title,
  fileOfRecord,
}: {
  anchor: string;
  number: string;
  title: string;
  fileOfRecord: string;
}): ReactNode {
  return (
    <li
      id={anchor}
      className="panel p-4 flex flex-col gap-1"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <h2 className="text-[14px] font-medium">
        §{number} {title}
      </h2>
      <p className="text-[12px] text-[var(--fg-dim)]">
        File of record: <code>{fileOfRecord}</code>
      </p>
      <p className="text-[12px] text-[var(--fg-dimmer)]">
        Live examples land in <strong>PR B</strong>. See FU6 task
        spec §{number} for the state matrix this section will render.
      </p>
    </li>
  );
}

function Footer(): ReactNode {
  return (
    <footer className="text-[11px] text-[var(--fg-dimmer)] mt-4">
      M4a-FU6 PR A skeleton. Spec:{" "}
      <code>
        docs/specs/expandability-foundation/m4a-fu6-task-spec.md
      </code>
      . Written rules:{" "}
      <code>docs/UI-GUIDELINES.md</code>.
    </footer>
  );
}
