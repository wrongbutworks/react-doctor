import { Text } from "ink";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { severityVariant } from "../lib/severity-variants.js";

export interface DiagnosticItemProps {
  readonly row: DiagnosticRow;
  readonly isSelected: boolean;
}

/**
 * One collapsed rule-group line. Mirrors the CLI's rule headline
 * (`✖ Category: Title ×N`) — icon + headline colored by severity, a dim
 * `×N` site badge, and a gray location — with a `›` pointer on the selected row.
 */
export const DiagnosticItem = ({ row, isSelected }: DiagnosticItemProps) => {
  const variant = severityVariant(row.severity);

  return (
    <Text wrap="truncate-end">
      <Text color={isSelected ? variant.color : undefined}>{isSelected ? "› " : "  "}</Text>
      <Text color={variant.color}>{variant.icon} </Text>
      <Text color={variant.color} bold={isSelected}>
        {row.category}: {row.title}
      </Text>
      {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
      <Text dimColor>
        {"  "}
        {row.location}
      </Text>
    </Text>
  );
};
