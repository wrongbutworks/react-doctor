import { getSkillAgentConfig } from "agent-install";
import { Box, Text } from "ink";
import type { CliAgentId } from "../../utils/launch-agent.js";

export interface DiagnosticActionsProps {
  /** Launchable agents, in order; rendered between Copy and the read toggle. */
  readonly launchableAgents: ReadonlyArray<CliAgentId>;
  /** Whether the selected issue is currently marked read. */
  readonly isRead: boolean;
  /** True right after the selected issue's prompt was copied. */
  readonly justCopied: boolean;
  /** Whether this pane holds focus (then `↑/↓` + Enter drive it). */
  readonly isFocused: boolean;
  /** Index of the focused action (Copy = 0, agents next, read toggle last). */
  readonly focusedIndex: number;
}

/**
 * The order actions are laid out in — the single source of truth shared with
 * `DiagnosticList`'s key handler so a focused index always maps to the same
 * action: Copy, then each launchable agent, then the read toggle.
 */
export const actionCount = (agentCount: number): number => agentCount + 2;

const ActionRow = ({
  label,
  isFocused,
  trailing,
}: {
  readonly label: string;
  readonly isFocused: boolean;
  readonly trailing?: string;
}) => (
  <Text wrap="truncate-end">
    <Text color={isFocused ? "cyan" : undefined}>{isFocused ? "› " : "  "}</Text>
    <Text color={isFocused ? "cyan" : undefined} dimColor={!isFocused}>
      {label}
    </Text>
    {trailing ? <Text color="green">{`  ${trailing}`}</Text> : null}
  </Text>
);

/**
 * The right-panel triage actions for the selected issue: copy a focused fix
 * prompt, hand it to a detected CLI agent (Claude Code / Codex / Cursor), or
 * flip the issue's read state. The pane is navigated by focus — `Tab` moves in,
 * `↑/↓` highlights a row, Enter runs it — so there are no per-row hotkeys to
 * memorize.
 */
export const DiagnosticActions = ({
  launchableAgents,
  isRead,
  justCopied,
  isFocused,
  focusedIndex,
}: DiagnosticActionsProps) => {
  const toggleIndex = actionCount(launchableAgents.length) - 1;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate-end">
        <Text bold>Actions</Text>
        <Text dimColor>{isFocused ? "  ↑/↓ · enter · esc back" : "  tab to focus"}</Text>
      </Text>
      <ActionRow
        label="Copy fix prompt"
        isFocused={isFocused && focusedIndex === 0}
        trailing={justCopied ? "✓ copied" : undefined}
      />
      {launchableAgents.map((agentId, index) => (
        <ActionRow
          key={agentId}
          label={`Run in ${getSkillAgentConfig(agentId).displayName}`}
          isFocused={isFocused && focusedIndex === index + 1}
        />
      ))}
      <ActionRow
        label={isRead ? "Mark unread" : "Mark read"}
        isFocused={isFocused && focusedIndex === toggleIndex}
      />
    </Box>
  );
};
