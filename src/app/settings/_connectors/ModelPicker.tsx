// Searchable model picker (M4a-5 PR C, spec §11).
//
// Pure render component. The PARENT owns the Model text input, the typed
// filter, and `highlightedIndex` — that hoisting keeps keyboard
// dispatching trivial (the parent's input.onKeyDown is the single source
// of truth) and removes the need for an imperative ref.
//
// Locked behaviour (spec §11):
//   * Filter is a case-insensitive substring match on `id`; the FULL
//     model list stays in provider order (no client-side sort).
//   * `visible` is the parent's already-filtered + already-capped list
//     (cap = 200); when `totalMatches > visible.length`, the parent
//     surfaces an "X more matches — refine search" banner here.
//   * Up/Down / Enter / Escape are handled by the parent input — the
//     picker just renders the highlight (`aria-activedescendant`).
//   * Clicking an option fills the Model field via `onSelect`. The
//     option's `onMouseDown` prevents the input from blurring during
//     the click so the picker doesn't close mid-tap.
//   * Manual model entry is ALWAYS available — this component never
//     mutates the Model field on render, only when the user explicitly
//     selects an option.

"use client";

import type { ReactNode } from "react";

export interface ModelEntry {
  id: string;
}

export const MODEL_PICKER_VISIBLE_CAP = 200;

interface ModelPickerProps {
  /** DOM id for the listbox — referenced by the input's aria-controls. */
  listId: string;
  /** The already-filtered + already-capped slice the parent computed. */
  visible: ReadonlyArray<ModelEntry>;
  /** Total matches for the current filter (BEFORE the cap). When greater
   *  than `visible.length`, the picker renders a "showing first N" banner. */
  totalMatches: number;
  /** Highlighted row index inside `visible`. */
  highlightedIndex: number;
  /** Pointer/hover updates the highlight without selecting. */
  onHover(index: number): void;
  /** A row was clicked — parent fills the input + closes the picker. */
  onSelect(id: string): void;
  /** Empty-state node (rendered when no models loaded; surfaces a
   *  neutral message). Only rendered when `visible.length === 0`. */
  emptyState?: ReactNode;
}

export function ModelPicker({
  listId,
  visible,
  totalMatches,
  highlightedIndex,
  onHover,
  onSelect,
  emptyState,
}: ModelPickerProps) {
  const overflow = totalMatches > visible.length;
  const optId = (i: number): string => `${listId}-opt-${i}`;
  const activeId = visible.length > 0 ? optId(highlightedIndex) : undefined;

  if (visible.length === 0) {
    // The container keeps `id={listId}` + `role="listbox"` even when empty
    // so the combobox input's `aria-controls` always points to a real
    // listbox element (assistive tech doesn't get a dangling reference).
    return (
      <div
        id={listId}
        role="listbox"
        aria-activedescendant={undefined}
        className="panel mt-1 p-2"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <p className="text-[12px] text-[var(--fg-dim)]">
          {emptyState ?? "No matches — refine the search or enter a model id manually."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="panel mt-1 max-h-[240px] overflow-auto"
      style={{ borderColor: "var(--panel-border)" }}
    >
      {overflow && (
        <p
          className="text-[11px] text-[var(--fg-dimmer)] px-2 py-1 border-b"
          style={{ borderColor: "var(--panel-border)" }}
          aria-live="polite"
        >
          Showing first {visible.length} of {totalMatches} matches — refine search.
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-activedescendant={activeId}
        className="flex flex-col"
      >
        {visible.map((m, i) => {
          const highlighted = i === highlightedIndex;
          return (
            <li
              key={m.id}
              id={optId(i)}
              role="option"
              aria-selected={highlighted}
              // onMouseDown prevents the Model input from blurring before
              // the click registers — without it, the input would lose
              // focus, the picker would close on blur, and the click
              // would never fire its onClick handler.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onSelect(m.id)}
              className="px-2.5 py-1 text-[13px] font-mono cursor-pointer"
              style={{
                background: highlighted ? "var(--panel-border)" : "transparent",
              }}
            >
              {m.id}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
