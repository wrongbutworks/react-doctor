import { Text } from "ink";

export interface StatusBarProps {
  readonly total: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly position: number;
  readonly groupCount: number;
  readonly exitHint?: string;
}

/** Bottom chrome: counts (CLI-style severity coloring), position, and keymap. */
export const StatusBar = ({
  total,
  errorCount,
  warningCount,
  position,
  groupCount,
  exitHint = "q quit",
}: StatusBarProps) => (
  <Text wrap="truncate-end">
    <Text bold>
      {total} {total === 1 ? "issue" : "issues"}
    </Text>
    <Text dimColor> › </Text>
    <Text color="red">{errorCount} errors</Text>
    <Text dimColor>, </Text>
    <Text color="yellow" dimColor>
      {warningCount} warnings
    </Text>
    <Text dimColor>
      {"   "}
      {position}/{groupCount} · ↑↓ move · {exitHint}
    </Text>
  </Text>
);
