import { getSkillAgentConfig } from "agent-install";
import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { copyToClipboard, type CliAgentId } from "../../utils/launch-agent.js";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildDiagnosticListEntries } from "../lib/diagnostic-list-entries.js";
import type { DiagnosticListEntry } from "../lib/diagnostic-list-entries.js";
import { buildIssuePrompt } from "../lib/build-issue-prompt.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import type { TuiHandoffRequest } from "../scan-store.js";
import { DiagnosticActionMenu } from "./diagnostic-action-menu.js";
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
  /** Launchable CLI agents, in order; surfaced in the triage menu. */
  readonly launchableAgents: ReadonlyArray<CliAgentId>;
  /** Hands the selected issue's prompt to an agent; the caller exits + launches. */
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  /** True when this repo has no React Doctor CI workflow yet (shows the callout). */
  readonly canAddToCi?: boolean;
  /** Requests CI setup; the caller exits + scaffolds the workflow. */
  readonly onAddToCi?: () => void;
  /** When set (monorepo flat view), surfaced in the status bar. */
  readonly projectCount?: number;
  readonly onExit: () => void;
  readonly exitHint?: string;
}

const ADD_TO_CI_KEY = "a";
// Rows the status bar eats; the action modal centers in the space above it.
const MODAL_FOOTER_ROWS = 2;
const MIN_MODAL_BODY_ROWS = 6;

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
 * sit in the left column and the detail fills the right column beside them; on a
 * narrow one everything stacks.
 *
 * Triage: visiting an issue auto-marks it read (the status bar tracks how many
 * remain), and Enter raises a small menu over the issue to copy a focused fix
 * prompt or hand it to a launchable agent (which takes over the terminal once
 * the app exits).
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
  canAddToCi,
  onAddToCi,
  projectCount,
  onExit,
  exitHint,
}: DiagnosticListProps) => {
  const entries = useMemo(() => buildDiagnosticListEntries(rows), [rows]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);

  const isSplit = layout === "split";
  const { rows: terminalRows } = useStdoutDimensions();

  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: entries.length,
    height: listHeight,
    isSelectable: (index) => entries[index]?.kind === "item",
    isActive: !isMenuOpen,
  });

  const visibleEntries = entries.slice(visibleStart, visibleEnd);
  const selectedEntry = entries[selectedIndex];
  const selected = selectedEntry?.kind === "item" ? selectedEntry.row : null;
  const selectedRuleKey = selected?.ruleKey ?? null;

  const [readRuleKeys, setReadRuleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [copiedRuleKey, setCopiedRuleKey] = useState<string | null>(null);

  // The menu's rows: Copy first, then one per launchable agent. Labels stay
  // short (bare agent names) so the whole bar fits the panel without truncating.
  const menuLabels = useMemo(
    () => [
      "Copy prompt",
      ...launchableAgents.map((agentId) => getSkillAgentConfig(agentId).displayName),
    ],
    [launchableAgents],
  );

  // Inbox semantics: landing on an issue marks it read, so the status bar's
  // "N unread" counter tracks how far through the queue you are.
  useEffect(() => {
    if (!selectedRuleKey) return;
    setReadRuleKeys((previous) =>
      previous.has(selectedRuleKey) ? previous : new Set(previous).add(selectedRuleKey),
    );
  }, [selectedRuleKey]);

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

  // Menu index maps to: 0 = Copy, then one launchable agent per row.
  const runMenuItem = (): void => {
    if (menuIndex === 0) {
      copySelectedPrompt();
      setIsMenuOpen(false);
      return;
    }
    const agentId = launchableAgents[menuIndex - 1];
    if (agentId) launchSelectedInAgent(agentId);
  };

  const showCiCallout = Boolean(canAddToCi && onAddToCi);

  // Closed: the viewport owns ↑/↓; Enter raises the triage menu over the issue,
  // and (when offered) `a` scaffolds CI then exits.
  useInput(
    (input, key) => {
      if (input === "q" || key.escape) return onExit();
      if (showCiCallout && input === ADD_TO_CI_KEY) {
        onAddToCi?.();
        return onExit();
      }
      if (key.return && selected) {
        setMenuIndex(0);
        setIsMenuOpen(true);
      }
    },
    { isActive: !isMenuOpen },
  );

  // Open: ↑/↓ walk the modal's actions, Enter runs the choice, Esc dismisses.
  useInput(
    (input, key) => {
      if (key.escape) return setIsMenuOpen(false);
      if (key.upArrow || input === "k") {
        return setMenuIndex((index) => Math.max(0, index - 1));
      }
      if (key.downArrow || input === "j") {
        return setMenuIndex((index) => Math.min(menuLabels.length - 1, index + 1));
      }
      if (key.return) return runMenuItem();
    },
    { isActive: isMenuOpen },
  );

  const errorRows = rows.filter((row) => row.severity === "error");
  const warningRows = rows.filter((row) => row.severity === "warning");
  // Position among selectable items only (headers don't count toward the count).
  const itemPosition = entries
    .slice(0, selectedIndex + 1)
    .filter((entry) => entry.kind === "item").length;
  const unreadCount = rows.length - rows.filter((row) => readRuleKeys.has(row.ruleKey)).length;

  const listColumn = (
    <Box flexDirection="column" height={listHeight} width={isSplit ? listColumnWidth : width}>
      {visibleEntries.map((entry, index) =>
        renderEntry(entry, visibleStart + index, selectedIndex, readRuleKeys),
      )}
    </Box>
  );

  // The detail stays put; the triage menu is a bar pinned to the bottom of the
  // detail column (above the status bar) so the issue's code frame stays visible
  // while you choose. The copied confirmation rides under the detail.
  const detailContent = (
    <>
      <DiagnosticDetail row={selected} rootDirectory={rootDirectory} />
      {copiedRuleKey === selectedRuleKey ? (
        <Box marginTop={1}>
          <Text color="green">✓ Copied fix prompt</Text>
        </Box>
      ) : null}
    </>
  );

  const keyHints = isMenuOpen ? (
    <>
      <Text dimColor>↑/↓ select · </Text>
      <Text color="cyan">enter</Text>
      <Text dimColor> run · esc close</Text>
    </>
  ) : (
    <>
      <Text dimColor>↑/↓ move · </Text>
      <Text color="cyan">enter</Text>
      <Text dimColor> fix this</Text>
      {showCiCallout ? (
        <>
          <Text dimColor> · </Text>
          <Text color="green">{ADD_TO_CI_KEY}</Text>
          <Text dimColor> add CI</Text>
        </>
      ) : null}
    </>
  );

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
        keyHints={keyHints}
        exitHint={exitHint}
      />
    </Box>
  );

  // Enter floats this as a true overlay (Ink absolute positioning): the report
  // stays drawn behind it, the centered modal card is composited on top, so the
  // background isn't hidden — just dialogued over.
  const overlay =
    isMenuOpen && selected ? (
      <Box
        position="absolute"
        top={0}
        left={0}
        width={width}
        height={Math.max(MIN_MODAL_BODY_ROWS, terminalRows - MODAL_FOOTER_ROWS)}
        justifyContent="center"
        alignItems="center"
      >
        <DiagnosticActionMenu
          title={selected.title}
          itemLabels={menuLabels}
          focusedIndex={menuIndex}
          maxWidth={width}
        />
      </Box>
    ) : null;

  if (isSplit) {
    return (
      <Box flexDirection="column" width={width} position="relative">
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
            {detailContent}
          </Box>
        </Box>
        {statusBar}
        {overlay}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} position="relative">
      {header}
      <Box marginTop={1}>{listColumn}</Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      {detailContent}
      {statusBar}
      {overlay}
    </Box>
  );
};
