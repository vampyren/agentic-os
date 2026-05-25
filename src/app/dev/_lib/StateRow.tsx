// State-row wrapper for /dev/ui sections (M4a-FU6 PR B).
//
// Renders a labelled row holding one component example. Used by every
// section file under src/app/dev/ui/_sections/ to keep the layout
// consistent: the state name on the left in dim caps; the rendered
// component on the right; an optional inline note below.

import type { ReactNode } from "react";

interface Props {
  label: string;
  note?: string;
  children: ReactNode;
}

export default function StateRow({ label, note, children }: Props) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 items-start py-2 border-b last:border-b-0"
         style={{ borderColor: "var(--panel-border)" }}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)]">
          {label}
        </span>
        {note && (
          <span className="text-[10px] text-[var(--fg-dimmer)] italic">
            {note}
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Outer wrapper for a §4.X section in /dev/ui. Carries the anchor id
 *  that docs/UI-GUIDELINES.md links into, plus the section title + the
 *  production-source / alignment-status sub-label.
 *
 *  The `kind` prop documents the relationship between this section's
 *  rendering and production:
 *
 *    "import"      — section imports the production component
 *                    directly (e.g. /dev/ui#status-pills imports
 *                    src/components/Pill.tsx). What you see IS what
 *                    production renders today.
 *    "hand-mirror" — section hand-mirrors an inline-only production
 *                    shape because the production component is not
 *                    exported and refactoring would violate PR scope.
 *                    Visual essence matches; the styling on /dev/ui
 *                    is the CANONICAL TARGET the production
 *                    component should converge toward.
 *    "target"      — section defines a NEW canonical target that
 *                    production has not yet implemented (e.g. modal
 *                    header centering). Production alignment lands
 *                    in a later scoped PR; until then production
 *                    deliberately lags.
 *
 *  The sub-label rendering reflects the kind so reviewers do not
 *  assume production already matches /dev/ui byte-for-byte. */
export type SectionKind = "import" | "hand-mirror" | "target";

export function Section({
  anchor,
  number,
  title,
  fileOfRecord,
  kind = "hand-mirror",
  children,
}: {
  anchor: string;
  number: string;
  title: string;
  fileOfRecord: string;
  kind?: SectionKind;
  children: ReactNode;
}) {
  const kindLabel =
    kind === "import"
      ? "Direct production import"
      : kind === "target"
      ? "Canonical target (production alignment pending)"
      : "Hand-mirror of inline production shape (canonical target)";
  return (
    <li
      id={anchor}
      className="panel p-4 flex flex-col gap-3"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="text-[14px] font-medium">
          §{number} {title}
        </h2>
        <p className="text-[11px] text-[var(--fg-dimmer)]">
          Production source / alignment reference:{" "}
          <code className="text-[var(--fg-dim)]">{fileOfRecord}</code>
        </p>
        <p className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)] mt-0.5">
          {kindLabel}
        </p>
      </header>
      <div className="flex flex-col gap-0">{children}</div>
    </li>
  );
}
