import { Text } from "ink";

export interface StatusBarProps {
  readonly total: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly position: number;
  readonly groupCount: number;
  /** Issues not yet triaged ("read") — shown as a "· N unread" span. */
  readonly unreadCount?: number;
  /** When set (monorepo flat view), shows a "· N projects" span. */
  readonly projectCount?: number;
  /** Context-sensitive navigation hint (e.g. "↑/↓ move · tab actions"). */
  readonly keyHints?: string;
  readonly exitHint?: string;
}

/** Bottom chrome: counts (CLI-style severity coloring), position, and keymap. */
export const StatusBar = ({
  total,
  errorCount,
  warningCount,
  position,
  groupCount,
  unreadCount,
  projectCount,
  keyHints = "↑/↓ to move",
  exitHint = "q to quit",
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
    {unreadCount !== undefined ? (
      <Text color={unreadCount > 0 ? "cyan" : undefined} dimColor={unreadCount === 0}>
        {" · "}
        {unreadCount} unread
      </Text>
    ) : null}
    {projectCount !== undefined ? (
      <Text dimColor>
        {" · "}
        {projectCount} {projectCount === 1 ? "project" : "projects"}
      </Text>
    ) : null}
    <Text dimColor>
      {"   "}
      {position}/{groupCount} · {keyHints} · {exitHint}
    </Text>
  </Text>
);
