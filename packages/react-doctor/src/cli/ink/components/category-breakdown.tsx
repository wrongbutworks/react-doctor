import { Box, Text } from "ink";
import type { Diagnostic } from "@react-doctor/core";
import { buildCategoryTallies } from "../lib/category-tallies.js";

export interface CategoryBreakdownProps {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const pluralize = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

/** The compact "Security › 6 errors, 2 warnings" tally lines, one per category. */
export const CategoryBreakdown = ({ diagnostics }: CategoryBreakdownProps) => {
  const tallies = buildCategoryTallies(diagnostics);
  if (tallies.length === 0) return null;

  return (
    <Box flexDirection="column">
      {tallies.map((tally) => (
        <Text key={tally.category} wrap="truncate-end">
          {"  "}
          <Text bold>{tally.category}</Text>
          <Text dimColor> › </Text>
          {tally.errorCount > 0 ? (
            <Text color="red">{pluralize(tally.errorCount, "error")}</Text>
          ) : null}
          {tally.errorCount > 0 && tally.warningCount > 0 ? <Text dimColor>, </Text> : null}
          {tally.warningCount > 0 ? (
            <Text color="yellow">{pluralize(tally.warningCount, "warning")}</Text>
          ) : null}
        </Text>
      ))}
    </Box>
  );
};
