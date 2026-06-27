import { Box, Text, useInput } from "ink";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticItem } from "./diagnostic-item.js";
import { StatusBar } from "./status-bar.js";

export interface DiagnosticListProps {
  readonly rows: ReadonlyArray<DiagnosticRow>;
  readonly width: number;
  readonly listHeight: number;
  readonly rootDirectory: string;
  readonly onExit: () => void;
  readonly exitHint?: string;
}

const sumSites = (rows: ReadonlyArray<DiagnosticRow>): number =>
  rows.reduce((total, row) => total + row.siteCount, 0);

/**
 * The scrollable, score-sorted rule-group list with a live detail preview —
 * the heart of the interactive report. Scroll/selection logic comes from the
 * headless `useScrollViewport`; this component is the chrome on top.
 */
export const DiagnosticList = ({
  rows,
  width,
  listHeight,
  rootDirectory,
  onExit,
  exitHint,
}: DiagnosticListProps) => {
  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: rows.length,
    height: listHeight,
  });

  useInput((input, key) => {
    if (input === "q" || key.escape) onExit();
  });

  const visibleRows = rows.slice(visibleStart, visibleEnd);
  const selected = rows[selectedIndex] ?? null;
  const errorRows = rows.filter((row) => row.severity === "error");
  const warningRows = rows.filter((row) => row.severity === "warning");

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="column" height={listHeight}>
        {visibleRows.map((row, index) => (
          <DiagnosticItem
            key={row.ruleKey}
            row={row}
            isSelected={visibleStart + index === selectedIndex}
          />
        ))}
      </Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      <DiagnosticDetail row={selected} rootDirectory={rootDirectory} />
      <Box marginTop={1}>
        <StatusBar
          total={sumSites(rows)}
          errorCount={sumSites(errorRows)}
          warningCount={sumSites(warningRows)}
          position={rows.length === 0 ? 0 : selectedIndex + 1}
          groupCount={rows.length}
          exitHint={exitHint}
        />
      </Box>
    </Box>
  );
};
