import { Box, Text } from "ink";

export interface DiagnosticActionMenuProps {
  /** The selected issue's title, shown so the bar keeps its context. */
  readonly title: string;
  /** Action labels in order — Copy first, then each launchable agent. */
  readonly itemLabels: ReadonlyArray<string>;
  readonly focusedIndex: number;
  /** Width the bar spans, so it reads as a fixed bottom strip. */
  readonly width: number;
}

/**
 * The triage action bar: a fixed, hovering strip pinned to the bottom of the
 * report (just above the status bar) while the menu is open. Lays the actions
 * out horizontally — copy a focused fix prompt or hand it to a detected CLI
 * agent — navigated with `←/→` and chosen with Enter, so the detail above stays
 * visible the whole time.
 */
export const DiagnosticActionMenu = ({
  title,
  itemLabels,
  focusedIndex,
  width,
}: DiagnosticActionMenuProps) => (
  <Box width={width} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
    <Text wrap="truncate-end">
      <Text dimColor>Fix </Text>
      <Text bold>{title}</Text>
    </Text>
    <Text wrap="truncate-end">
      {itemLabels.map((label, index) => {
        const isFocused = index === focusedIndex;
        return (
          <Text key={label}>
            {index > 0 ? <Text dimColor>{"   "}</Text> : null}
            <Text color={isFocused ? "cyan" : undefined} bold={isFocused} dimColor={!isFocused}>
              {isFocused ? `› ${label}` : `  ${label}`}
            </Text>
          </Text>
        );
      })}
    </Text>
  </Box>
);
