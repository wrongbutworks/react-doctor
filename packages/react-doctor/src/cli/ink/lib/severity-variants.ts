import isUnicodeSupported from "is-unicode-supported";

export type Severity = "error" | "warning";

export interface SeverityVariant {
  /** Ink `<Text color>` value. */
  readonly color: string;
  readonly icon: string;
  readonly label: string;
}

const ICONS = isUnicodeSupported()
  ? ({ error: "✖", warning: "⚠" } as const)
  : ({ error: "x", warning: "!" } as const);

/**
 * The `cva`-style single source of severity styling: maps a diagnostic
 * severity onto the Ink `<Text>` color, glyph, and label so components
 * stay declarative instead of scattering severity ternaries.
 */
export const severityVariant = (severity: Severity): SeverityVariant =>
  severity === "error"
    ? { color: "red", icon: ICONS.error, label: "error" }
    : { color: "yellow", icon: ICONS.warning, label: "warning" };
