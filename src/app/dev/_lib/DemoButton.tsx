// Shared canonical button for /dev/ui examples (M4a-FU6 PR B amend).
//
// Production has many one-off button styles inline; FU6 picks the
// canonical shape here so every /dev/ui section renders buttons that
// feel like the SAME family. UI-GUIDELINES.md §5 (button patterns)
// names the variants + states this component implements.
//
// Variants:
//   primary    — filled affirmative action ("Add", "Save"). bg = --fg,
//                text = --bg.
//   secondary  — bordered surface action ("Test", "Retry", "Load
//                models"). bg = --bg-elevated, border = --panel-border.
//   ghost      — minimal text-only action for low-emphasis cases
//                ("Back", or future "Cancel" in carve-out flows).
//                Transparent bg until hovered.
//   danger     — destructive filled action ("Delete"). bg =
//                --status-invalid.
//   icon       — square icon-only button ("Close" ×, "Back" ‹). 28px
//                hit target; aria-label mandatory.
//
// Sizes: sm (px-2.5 py-1 text-[11px]), md (px-3 py-1.5 text-[12px]),
// icon (28×28).
//
// States are passed as visual props (no actual interaction): every
// demo row renders a fixed state so reviewers can compare side-by-side.

import type { ReactNode } from "react";

export type DemoButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon";
export type DemoButtonSize = "sm" | "md";

interface Props {
  children?: ReactNode;
  variant?: DemoButtonVariant;
  size?: DemoButtonSize;
  /** Demo states — visually rendered, not actually interactive. */
  hovered?: boolean;
  focused?: boolean;
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Required for icon-only buttons (visual variant: "icon"). */
  ariaLabel?: string;
}

export default function DemoButton({
  children,
  variant = "secondary",
  size = "sm",
  hovered = false,
  focused = false,
  selected = false,
  disabled = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  ariaLabel,
}: Props) {
  const isIcon = variant === "icon";
  const isDisabled = disabled || loading;

  const sizing =
    isIcon
      ? "w-7 h-7 flex items-center justify-center rounded-md text-[12px]"
      : size === "md"
        ? "px-3 py-1.5 text-[12px] rounded-md"
        : "px-2.5 py-1 text-[11px] rounded-md";

  // Pre-computed visual state styles so the demos can render a stable
  // "hover" / "focus" / "selected" look without real interaction.
  const styles = computeStyles({
    variant,
    hovered,
    focused,
    selected,
    disabled: isDisabled,
  });

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-label={isIcon ? ariaLabel : undefined}
      className={`${sizing} cursor-default inline-flex items-center gap-1.5 border transition-colors disabled:cursor-not-allowed`}
      style={styles}
    >
      {leadingIcon && <span className="shrink-0 inline-flex">{leadingIcon}</span>}
      {!isIcon && children}
      {isIcon && children}
      {trailingIcon && <span className="shrink-0 inline-flex">{trailingIcon}</span>}
    </button>
  );
}

function computeStyles({
  variant,
  hovered,
  focused,
  selected,
  disabled,
}: {
  variant: DemoButtonVariant;
  hovered: boolean;
  focused: boolean;
  selected: boolean;
  disabled: boolean;
}): React.CSSProperties {
  const ringStyle: React.CSSProperties = focused
    ? {
        boxShadow: "0 0 0 2px color-mix(in srgb, var(--fg) 18%, transparent)",
      }
    : {};

  const opacity = disabled ? 0.5 : 1;

  if (variant === "primary") {
    return {
      background: "var(--fg)",
      color: "var(--bg)",
      borderColor: "var(--fg)",
      opacity: disabled ? 0.5 : hovered ? 0.92 : 1,
      ...ringStyle,
    };
  }
  if (variant === "danger") {
    return {
      background: "var(--status-invalid)",
      // Use the page bg token for danger-button text instead of a
      // baked hex — keeps the token vocabulary the single source of
      // truth. AA contrast against --status-invalid (#f87171) holds
      // for --bg (#08090b) the same way it would for a near-black hex.
      color: "var(--bg)",
      borderColor: "var(--status-invalid)",
      opacity: disabled ? 0.5 : hovered ? 0.92 : 1,
      ...ringStyle,
    };
  }
  if (variant === "ghost") {
    return {
      background: hovered || selected
        ? "var(--bg-elevated)"
        : "transparent",
      color: hovered || selected ? "var(--fg)" : "var(--fg-dim)",
      borderColor: hovered || selected
        ? "var(--panel-border)"
        : "transparent",
      opacity,
      ...ringStyle,
    };
  }
  // secondary OR icon — both use the elevated-surface treatment that
  // makes the canonical /dev/ui button feel like a real button rather
  // than flat text. Selected = same as hover (no toggle UI in this
  // demo; selected reads as "active among siblings").
  const isHot = hovered || focused || selected;
  return {
    background: isHot
      ? "var(--bg-elevated-hot)"
      : "var(--bg-elevated)",
    color: "var(--fg)",
    borderColor: isHot
      ? "var(--panel-border-hot)"
      : "var(--panel-border)",
    opacity,
    ...ringStyle,
  };
}
