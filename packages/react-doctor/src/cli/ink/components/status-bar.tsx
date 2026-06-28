import { Text } from "ink";

export interface StatusBarProps {
  readonly total: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly position: number;
  readonly groupCount: number;
  /** When set (monorepo flat view), shows a "· N projects" span. */
  readonly projectCount?: number;
  readonly exitHint?: string;
}

/** Bottom chrome: counts (CLI-style severity coloring), position, and keymap. */
export const StatusBar = ({
  total,
  errorCount,
  warningCount,
  position,
  groupCount,
  projectCount,
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
    {projectCount !== undefined ? (
      <Text dimColor>
        {" · "}
        {projectCount} {projectCount === 1 ? "project" : "projects"}
      </Text>
    ) : null}
    <Text dimColor>
      {"   "}
      {position}/{groupCount} · ↑↓ move · {exitHint}
    </Text>
  </Text>
);
