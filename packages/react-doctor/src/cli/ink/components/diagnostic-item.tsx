import { Text } from "ink";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { severityVariant } from "../lib/severity-variants.js";

export interface DiagnosticItemProps {
  readonly row: DiagnosticRow;
  readonly isSelected: boolean;
}

/**
 * One collapsed rule-group line, rendered indented under its category header:
 * `› ✖ Title ×N` — icon + title colored by severity and a dim `×N` site badge,
 * with a `›` pointer on the selected row. The category lives in the header and
 * the file location lives in the detail pane, so the row stays uncluttered.
 */
export const DiagnosticItem = ({ row, isSelected }: DiagnosticItemProps) => {
  const variant = severityVariant(row.severity);

  return (
    <Text wrap="truncate-end">
      <Text color={isSelected ? variant.color : undefined}>{isSelected ? "› " : "  "}</Text>
      <Text color={variant.color}>{variant.icon} </Text>
      <Text color={variant.color} bold={isSelected}>
        {row.title}
      </Text>
      {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
    </Text>
  );
};
