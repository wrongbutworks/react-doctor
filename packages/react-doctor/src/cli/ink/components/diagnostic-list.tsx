import { Box, Text, useInput } from "ink";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { buildDiagnosticListEntries } from "../lib/diagnostic-list-entries.js";
import type { DiagnosticListEntry } from "../lib/diagnostic-list-entries.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
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
    />
  );
};

/**
 * The scrollable, category-grouped rule list with a live detail preview — the
 * heart of the interactive report. Each category is a bold header line followed
 * by its rules, so a row reads as "⚠ Title" instead of repeating the category.
 * Scroll/selection (headers skipped) comes from the headless `useScrollViewport`;
 * this component is the chrome on top. On a wide terminal the score header + list
 * sit in the left column and the detail fills the right column; otherwise the
 * detail stacks below.
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
  projectCount,
  onExit,
  exitHint,
}: DiagnosticListProps) => {
  const entries = useMemo(() => buildDiagnosticListEntries(rows), [rows]);
  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: entries.length,
    height: listHeight,
    isSelectable: (index) => entries[index]?.kind === "item",
  });

  useInput((input, key) => {
    if (input === "q" || key.escape) onExit();
  });

  const visibleEntries = entries.slice(visibleStart, visibleEnd);
  const selectedEntry = entries[selectedIndex];
  const selected = selectedEntry?.kind === "item" ? selectedEntry.row : null;
  const errorRows = rows.filter((row) => row.severity === "error");
  const warningRows = rows.filter((row) => row.severity === "warning");
  // Position among selectable items only (headers don't count toward the count).
  const itemPosition = entries
    .slice(0, selectedIndex + 1)
    .filter((entry) => entry.kind === "item").length;

  const isSplit = layout === "split";

  const listColumn = (
    <Box flexDirection="column" height={listHeight} width={isSplit ? listColumnWidth : width}>
      {visibleEntries.map((entry, index) =>
        renderEntry(entry, visibleStart + index, selectedIndex),
      )}
    </Box>
  );

  const statusBar = (
    <Box marginTop={1}>
      <StatusBar
        total={sumSites(rows)}
        errorCount={sumSites(errorRows)}
        warningCount={sumSites(warningRows)}
        position={rows.length === 0 ? 0 : itemPosition}
        groupCount={rows.length}
        projectCount={projectCount}
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
      {statusBar}
    </Box>
  );
};
