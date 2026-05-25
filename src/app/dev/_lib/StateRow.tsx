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
 *  "file of record" sub-label. */
export function Section({
  anchor,
  number,
  title,
  fileOfRecord,
  children,
}: {
  anchor: string;
  number: string;
  title: string;
  fileOfRecord: string;
  children: ReactNode;
}) {
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
          File of record: <code className="text-[var(--fg-dim)]">{fileOfRecord}</code>
        </p>
      </header>
      <div className="flex flex-col gap-0">{children}</div>
    </li>
  );
}
