import { Box, Text, useInput } from "ink";
import { useMemo } from "react";
import type { ScanReport } from "../scan-store.js";
import { useExitOnCtrlC } from "../hooks/use-exit-on-ctrl-c.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildCategoryTallies } from "../lib/category-tallies.js";
import { buildDiagnosticRows } from "../lib/diagnostic-rows.js";
import { CategoryBreakdown } from "./category-breakdown.js";
import { DiagnosticList } from "./diagnostic-list.js";
import { ScoreHeader } from "./score-header.js";

export interface ReportProps {
  readonly report: ScanReport;
  /** q / Esc handler. In a drill-in (monorepo) this pops back to the summary. */
  readonly onExit: () => void;
  /** Hint shown in the empty-state footer (e.g. "Esc back · q quit"). */
  readonly exitHint?: string;
}

// Score header (face box, 4 lines + trailing blank + the "you could improve"
// line), the detail preview (headline + message + fix + location + a ~7-line
// code frame), the divider, and the status bar — reserved off the terminal
// height so the list gets the rest. Generous so the code frame never clips.
const HEADER_ROWS = 6;
const DETAIL_ROWS = 13;
const STATUS_ROWS = 2;
const DIVIDER_ROWS = 1;
const CHROME_ROWS = HEADER_ROWS + DETAIL_ROWS + STATUS_ROWS + DIVIDER_ROWS + 1;
const MIN_LIST_ROWS = 3;
const MIN_WIDTH = 24;

/** Full interactive report: score header above the scrollable diagnostics list. */
export const Report = ({ report, onExit, exitHint = "q quit" }: ReportProps) => {
  const { rows: terminalRows, columns } = useStdoutDimensions();
  const diagnosticRows = useMemo(
    () => buildDiagnosticRows(report.diagnostics, report.score),
    [report.diagnostics, report.score],
  );
  const categoryRowCount = useMemo(
    () => buildCategoryTallies(report.diagnostics).length,
    [report.diagnostics],
  );

  useExitOnCtrlC();
  useInput((input, key) => {
    if (input === "q" || key.escape) onExit();
  });

  const width = Math.max(MIN_WIDTH, columns - 2);
  // The category breakdown sits between the header and the list; reserve its
  // rows (plus a one-line margin) so the list viewport doesn't overflow.
  const breakdownRows = categoryRowCount > 0 ? categoryRowCount + 1 : 0;
  const listHeight = Math.max(MIN_LIST_ROWS, terminalRows - CHROME_ROWS - breakdownRows);

  if (diagnosticRows.length === 0) {
    return (
      <Box flexDirection="column">
        <ScoreHeader
          score={report.score}
          projectedScore={report.projectedScore}
          projectName={report.projectName}
          issueCount={0}
          noScoreMessage={report.noScoreMessage}
        />
        <Box marginTop={1}>
          <Text color="green">✔ No issues found. Nice work.</Text>
        </Box>
        <Text dimColor>{exitHint}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <ScoreHeader
        score={report.score}
        projectedScore={report.projectedScore}
        projectName={report.projectName}
        issueCount={report.diagnostics.length}
        noScoreMessage={report.noScoreMessage}
      />
      <Box marginTop={1}>
        <CategoryBreakdown diagnostics={report.diagnostics} />
      </Box>
      <Box marginTop={1}>
        <DiagnosticList
          rows={diagnosticRows}
          width={width}
          listHeight={listHeight}
          rootDirectory={report.rootDirectory}
          onExit={onExit}
          exitHint={exitHint}
        />
      </Box>
    </Box>
  );
};
