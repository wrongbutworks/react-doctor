import { Box, Text } from "ink";
import { useMemo } from "react";
import { buildCodeFrame } from "../../utils/build-code-frame.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { severityVariant } from "../lib/severity-variants.js";

export interface DiagnosticDetailProps {
  readonly row: DiagnosticRow | null;
  readonly rootDirectory: string;
}

const INDENT = "    ";

/**
 * Detail for the selected rule group, styled after the CLI's rule block
 * (`render-diagnostics.ts`): icon + headline, impact prose, the dim `→` fix,
 * the gray location, and the syntax-highlighted source frame at the site.
 */
export const DiagnosticDetail = ({ row, rootDirectory }: DiagnosticDetailProps) => {
  const codeFrame = useMemo(() => {
    if (!row) return null;
    const { representative } = row;
    return buildCodeFrame({
      filePath: representative.filePath,
      line: representative.line,
      column: representative.column,
      rootDirectory,
    });
  }, [row, rootDirectory]);

  if (!row) return null;
  const variant = severityVariant(row.severity);
  const { representative } = row;

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={variant.color}>
          {"  "}
          {variant.icon}{" "}
        </Text>
        <Text color={variant.color} bold>
          {row.category}: {row.title}
        </Text>
        {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
      </Text>
      <Text wrap="wrap">
        {INDENT}
        {representative.message}
      </Text>
      {representative.help ? (
        <Text dimColor wrap="wrap">
          {INDENT}→ {representative.help}
        </Text>
      ) : null}
      <Text dimColor wrap="truncate-end">
        {INDENT}
        {row.location}
      </Text>
      {codeFrame ? (
        <Box marginTop={1}>
          <Text>{codeFrame}</Text>
        </Box>
      ) : null}
      {row.learnMore ? (
        <Box marginTop={1}>
          <Text color="cyan" wrap="truncate-end">
            {INDENT}
            {row.learnMore}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
