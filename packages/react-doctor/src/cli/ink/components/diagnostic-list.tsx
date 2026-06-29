import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { copyToClipboard, type CliAgentId } from "../../utils/launch-agent.js";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { buildDiagnosticListEntries } from "../lib/diagnostic-list-entries.js";
import type { DiagnosticListEntry } from "../lib/diagnostic-list-entries.js";
import { buildIssuePrompt } from "../lib/build-issue-prompt.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import type { TuiHandoffRequest } from "../scan-store.js";
import { DiagnosticActions, actionCount } from "./diagnostic-actions.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticItem } from "./diagnostic-item.js";
import { StatusBar } from "./status-bar.js";

export type DiagnosticListLayout = "split" | "stacked";

export interface DiagnosticListProps {
  /** The score header, rendered above the list (atop the left column in split). */
  readonly header: ReactNode;
  readonly rows: ReadonlyArray<DiagnosticRow>;
  readonly width: number;
  /** Left-column width in the split layout. */
  readonly listColumnWidth: number;
  /** Right-column (detail) width in the split layout. */
  readonly detailColumnWidth: number;
  readonly listHeight: number;
  /** "split" renders the detail beside the list; "stacked" puts it below. */
  readonly layout: DiagnosticListLayout;
  readonly rootDirectory: string;
  /** Project name, woven into the copied / handed-off fix prompt. */
  readonly projectName: string;
  /** Launchable CLI agents, in hotkey order; empty disables the run-in actions. */
  readonly launchableAgents: ReadonlyArray<CliAgentId>;
  /** Hands the selected issue's prompt to an agent; the caller exits + launches. */
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  /** When set (monorepo flat view), surfaced in the status bar. */
  readonly projectCount?: number;
  readonly onExit: () => void;
  readonly exitHint?: string;
}

const sumSites = (rows: ReadonlyArray<DiagnosticRow>): number =>
  rows.reduce((total, row) => total + row.siteCount, 0);

const renderEntry = (
  entry: DiagnosticListEntry,
  entryIndex: number,
  selectedIndex: number,
  readRuleKeys: ReadonlySet<string>,
): ReactNode => {
  if (entry.kind === "header") {
    return (
      <Text key={`header:${entry.category}`} bold wrap="truncate-end">
        {entry.category}
      </Text>
    );
  }
  return (
    <DiagnosticItem
      key={entry.row.ruleKey}
      row={entry.row}
      isSelected={entryIndex === selectedIndex}
      isRead={readRuleKeys.has(entry.row.ruleKey)}
    />
  );
};

/**
 * The scrollable, category-grouped rule list with a live detail preview — the
 * heart of the interactive report. Each category is a bold header line followed
 * by its rules, so a row reads as "⚠ Title" instead of repeating the category.
 * Scroll/selection (headers skipped) comes from the headless `useScrollViewport`;
 * this component is the chrome on top. On a wide terminal the score header + list
 * sit in the left column and the detail + triage actions fill the right column
 * beside them; on a narrow one everything stacks.
 *
 * Triage: the selected issue is auto-marked read (an inbox queue), `x` flips it,
 * `c` copies a focused fix prompt, and `1`..`N` hand that prompt to a launchable
 * agent (which takes over the terminal once the app exits).
 */
export const DiagnosticList = ({
  header,
  rows,
  width,
  listColumnWidth,
  detailColumnWidth,
  listHeight,
  layout,
  rootDirectory,
  projectName,
  launchableAgents,
  onHandoff,
  projectCount,
  onExit,
  exitHint,
}: DiagnosticListProps) => {
  const entries = useMemo(() => buildDiagnosticListEntries(rows), [rows]);
  const [focusedPane, setFocusedPane] = useState<"list" | "actions">("list");
  const [focusedActionIndex, setFocusedActionIndex] = useState(0);

  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: entries.length,
    height: listHeight,
    isSelectable: (index) => entries[index]?.kind === "item",
    isActive: focusedPane === "list",
  });

  const visibleEntries = entries.slice(visibleStart, visibleEnd);
  const selectedEntry = entries[selectedIndex];
  const selected = selectedEntry?.kind === "item" ? selectedEntry.row : null;
  const selectedRuleKey = selected?.ruleKey ?? null;
  const totalActions = actionCount(launchableAgents.length);

  const [readRuleKeys, setReadRuleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [copiedRuleKey, setCopiedRuleKey] = useState<string | null>(null);

  // Inbox semantics: landing on an issue marks it read. Keyed on the rule, so
  // toggling it back to unread sticks until the selection moves elsewhere.
  useEffect(() => {
    if (!selectedRuleKey) return;
    setReadRuleKeys((previous) =>
      previous.has(selectedRuleKey) ? previous : new Set(previous).add(selectedRuleKey),
    );
  }, [selectedRuleKey]);

  const toggleSelectedRead = (): void => {
    if (!selectedRuleKey) return;
    setReadRuleKeys((previous) => {
      const next = new Set(previous);
      if (next.has(selectedRuleKey)) next.delete(selectedRuleKey);
      else next.add(selectedRuleKey);
      return next;
    });
  };

  const copySelectedPrompt = (): void => {
    if (!selected) return;
    const prompt = buildIssuePrompt({ row: selected, projectName });
    const ruleKey = selected.ruleKey;
    void copyToClipboard(prompt).then((didCopy) => {
      if (didCopy) setCopiedRuleKey(ruleKey);
    });
  };

  const launchSelectedInAgent = (agentId: CliAgentId): void => {
    if (!selected || !onHandoff) return;
    onHandoff({ agentId, prompt: buildIssuePrompt({ row: selected, projectName }) });
    onExit();
  };

  // Focused index maps to: 0 = Copy, 1..N = launchable agents, last = read toggle
  // (the same order `DiagnosticActions` renders).
  const runFocusedAction = (): void => {
    if (focusedActionIndex === 0) return copySelectedPrompt();
    if (focusedActionIndex <= launchableAgents.length) {
      const agentId = launchableAgents[focusedActionIndex - 1];
      if (agentId) launchSelectedInAgent(agentId);
      return;
    }
    toggleSelectedRead();
  };

  const focusActions = (): void => {
    if (!selected) return;
    setFocusedActionIndex(0);
    setFocusedPane("actions");
  };

  // List pane: the viewport owns ↑/↓; here we only handle quit and the move
  // into the actions pane.
  useInput(
    (input, key) => {
      if (input === "q" || key.escape) return onExit();
      if (key.tab || key.rightArrow) return focusActions();
    },
    { isActive: focusedPane === "list" },
  );

  // Actions pane: ↑/↓ walks the rows, Enter runs the focused one, and
  // Tab/Esc/← hand focus back to the list.
  useInput(
    (input, key) => {
      if (input === "q") return onExit();
      if (key.escape || key.leftArrow || key.tab) return setFocusedPane("list");
      if (key.upArrow || input === "k") {
        return setFocusedActionIndex((index) => Math.max(0, index - 1));
      }
      if (key.downArrow || input === "j") {
        return setFocusedActionIndex((index) => Math.min(totalActions - 1, index + 1));
      }
      if (key.return) return runFocusedAction();
    },
    { isActive: focusedPane === "actions" },
  );

  const errorRows = rows.filter((row) => row.severity === "error");
  const warningRows = rows.filter((row) => row.severity === "warning");
  // Position among selectable items only (headers don't count toward the count).
  const itemPosition = entries
    .slice(0, selectedIndex + 1)
    .filter((entry) => entry.kind === "item").length;
  const unreadCount = rows.length - rows.filter((row) => readRuleKeys.has(row.ruleKey)).length;

  const isSplit = layout === "split";

  const listColumn = (
    <Box flexDirection="column" height={listHeight} width={isSplit ? listColumnWidth : width}>
      {visibleEntries.map((entry, index) =>
        renderEntry(entry, visibleStart + index, selectedIndex, readRuleKeys),
      )}
    </Box>
  );

  const actions = selected ? (
    <DiagnosticActions
      launchableAgents={launchableAgents}
      isRead={selectedRuleKey !== null && readRuleKeys.has(selectedRuleKey)}
      justCopied={copiedRuleKey === selectedRuleKey}
      isFocused={focusedPane === "actions"}
      focusedIndex={focusedActionIndex}
    />
  ) : null;

  const statusBar = (
    <Box marginTop={1}>
      <StatusBar
        total={sumSites(rows)}
        errorCount={sumSites(errorRows)}
        warningCount={sumSites(warningRows)}
        position={rows.length === 0 ? 0 : itemPosition}
        groupCount={rows.length}
        unreadCount={unreadCount}
        projectCount={projectCount}
        keyHints={
          focusedPane === "actions" ? "↑/↓ action · enter run · esc back" : "↑/↓ move · tab actions"
        }
        exitHint={exitHint}
      />
    </Box>
  );

  if (isSplit) {
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row">
          <Box flexDirection="column" width={listColumnWidth} marginRight={1}>
            {header}
            <Box marginTop={1}>{listColumn}</Box>
          </Box>
          <Box
            flexDirection="column"
            width={detailColumnWidth}
            borderStyle="single"
            borderColor="gray"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            paddingLeft={1}
          >
            <DiagnosticDetail row={selected} rootDirectory={rootDirectory} />
            {actions}
          </Box>
        </Box>
        {statusBar}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      {header}
      <Box marginTop={1}>{listColumn}</Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      <DiagnosticDetail row={selected} rootDirectory={rootDirectory} />
      {actions}
      {statusBar}
    </Box>
  );
};
