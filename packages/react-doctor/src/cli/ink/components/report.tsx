import { Box, Text, useInput } from "ink";
import { useMemo } from "react";
import type { CliAgentId } from "../../utils/launch-agent.js";
import type { ScanReport, TuiHandoffRequest } from "../scan-store.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildDiagnosticRows } from "../lib/diagnostic-rows.js";
import { DiagnosticList } from "./diagnostic-list.js";
import { ScoreHeader } from "./score-header.js";

export interface ReportProps {
  readonly report: ScanReport;
  /** q / Esc handler that exits the app. */
  readonly onExit: () => void;
  /** Launchable CLI agents, in hotkey order, for the right-panel triage actions. */
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  /** Hands the selected issue's prompt to an agent; the caller exits + launches. */
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  /** True when this repo has no React Doctor CI workflow yet (shows the callout). */
  readonly canAddToCi?: boolean;
  /** Requests CI setup; the caller exits + scaffolds the workflow. */
  readonly onAddToCi?: () => void;
  /** When set (monorepo flat view), shows a "· N projects" span in the status bar. */
  readonly projectCount?: number;
  /** Hint shown in the empty-state footer (e.g. "Esc to go back · q to quit"). */
  readonly exitHint?: string;
}

// Rows the score header eats (face box, 4 lines + trailing blank + the "you
// could improve" line), the stacked detail preview (headline + message + fix +
// location + a bordered ~7-line code frame), the divider, and the status bar —
// reserved off the terminal height so the list gets the rest.
const HEADER_ROWS = 6;
const DETAIL_ROWS = 15;
const STATUS_ROWS = 2;
const DIVIDER_ROWS = 1;
const LIST_MARGIN_ROWS = 1;
// Stacked (narrow): header, list, divider, detail, and status all stack. The
// triage menu reuses the detail region when open, so it needs no extra rows.
const STACKED_CHROME_ROWS =
  HEADER_ROWS + LIST_MARGIN_ROWS + DETAIL_ROWS + DIVIDER_ROWS + STATUS_ROWS;
// Split (wide): the header sits atop the list in the left column and the detail
// fills the right column beside both, so only the header, the list margin, and
// the status bar are reserved off the column height.
const SPLIT_CHROME_ROWS = HEADER_ROWS + LIST_MARGIN_ROWS + STATUS_ROWS;
const MIN_LIST_ROWS = 3;
const MIN_WIDTH = 24;
// Below either of these the side-by-side layout is too cramped (the list and
// the detail's code frame fight for width / height), so fall back to stacked.
const WIDE_LAYOUT_MIN_COLUMNS = 120;
const WIDE_LAYOUT_MIN_ROWS = 22;
// Share of the width the detail column gets in the split layout (the code frame
// reads better with the larger share); the list takes the rest minus a gutter.
const DETAIL_WIDTH_FRACTION = 0.6;
const COLUMN_GUTTER_WIDTH = 3;
const MIN_COLUMN_WIDTH = 20;

/**
 * Full interactive report: the score header above the scrollable, category-
 * grouped diagnostics list. On a wide terminal the header sits atop the list in
 * the left column and the detail preview fills the right column beside them; on
 * a narrow one everything stacks.
 */
export const Report = ({
  report,
  onExit,
  launchableAgents = [],
  onHandoff,
  canAddToCi,
  onAddToCi,
  projectCount,
  exitHint = "q to quit",
}: ReportProps) => {
  const { rows: terminalRows, columns } = useStdoutDimensions();
  const diagnosticRows = useMemo(
    () => buildDiagnosticRows(report.diagnostics, report.score),
    [report.diagnostics, report.score],
  );

  // Only the empty-state view below owns q/Esc; once there are rows the
  // DiagnosticList handles input (Esc there means "leave the actions pane").
  useInput(
    (input, key) => {
      if (input === "q" || key.escape) onExit();
    },
    { isActive: diagnosticRows.length === 0 },
  );

  const width = Math.max(MIN_WIDTH, columns - 2);
  const isWide = columns >= WIDE_LAYOUT_MIN_COLUMNS && terminalRows >= WIDE_LAYOUT_MIN_ROWS;
  const listHeight = Math.max(
    MIN_LIST_ROWS,
    terminalRows - (isWide ? SPLIT_CHROME_ROWS : STACKED_CHROME_ROWS),
  );
  const detailColumnWidth = Math.max(MIN_COLUMN_WIDTH, Math.floor(width * DETAIL_WIDTH_FRACTION));
  const listColumnWidth = Math.max(
    MIN_COLUMN_WIDTH,
    width - detailColumnWidth - COLUMN_GUTTER_WIDTH,
  );

  const scoreHeader = (
    <ScoreHeader
      score={report.score}
      projectedScore={report.projectedScore}
      projectName={report.projectName}
      issueCount={report.diagnostics.length}
      noScoreMessage={report.noScoreMessage}
      width={isWide ? listColumnWidth : width}
    />
  );

  if (diagnosticRows.length === 0) {
    return (
      <Box flexDirection="column">
        {scoreHeader}
        <Box marginTop={1}>
          <Text color="green">✔ No issues found. Nice work.</Text>
        </Box>
        <Text dimColor>{exitHint}</Text>
      </Box>
    );
  }

  return (
    <DiagnosticList
      header={scoreHeader}
      rows={diagnosticRows}
      width={width}
      listColumnWidth={listColumnWidth}
      detailColumnWidth={detailColumnWidth}
      listHeight={listHeight}
      layout={isWide ? "split" : "stacked"}
      rootDirectory={report.rootDirectory}
      projectName={report.projectName}
      launchableAgents={launchableAgents}
      onHandoff={onHandoff}
      canAddToCi={canAddToCi}
      onAddToCi={onAddToCi}
      projectCount={projectCount}
      onExit={onExit}
      exitHint={exitHint}
    />
  );
};
