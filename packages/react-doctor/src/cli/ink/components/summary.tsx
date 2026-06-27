import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { MultiProjectSummary } from "../scan-store.js";
import { useExitOnCtrlC } from "../hooks/use-exit-on-ctrl-c.js";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { scoreBandLabel } from "../../utils/score-band-label.js";
import { scoreColorName } from "../lib/score-color.js";
import { CategoryBreakdown } from "./category-breakdown.js";
import { Report } from "./report.js";
import { ScoreHeader } from "./score-header.js";

export interface SummaryProps {
  readonly summary: MultiProjectSummary;
  readonly onExit: () => void;
}

// Aggregate header (face box + improve line), the combined category breakdown,
// a one-line margin, and the status row — reserved off the terminal height.
const HEADER_ROWS = 7;
const STATUS_ROWS = 2;
const MIN_LIST_ROWS = 3;

const pluralize = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

/**
 * The monorepo aggregate view: the worst project's score, the combined category
 * breakdown, and a scrollable project list. Enter drills into a project's full
 * report; Esc there pops back here.
 */
export const Summary = ({ summary, onExit }: SummaryProps) => {
  const { rows: terminalRows, columns } = useStdoutDimensions();
  const [drilledIndex, setDrilledIndex] = useState<number | null>(null);
  useExitOnCtrlC();

  const drilled = drilledIndex === null ? null : (summary.projects[drilledIndex] ?? null);

  const categoryRowCount = (() => {
    const categories = new Set(
      summary.combinedDiagnostics.map((diagnostic) => diagnostic.category),
    );
    return categories.size;
  })();
  const breakdownRows = categoryRowCount > 0 ? categoryRowCount + 1 : 0;
  const listHeight = Math.max(
    MIN_LIST_ROWS,
    terminalRows - HEADER_ROWS - STATUS_ROWS - breakdownRows,
  );

  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: summary.projects.length,
    height: listHeight,
    isActive: drilled === null,
    onActivate: (index) => setDrilledIndex(index),
  });

  // Only quits at the top level; in a drill-in the child `Report` owns Esc/q.
  useInput(
    (input) => {
      if (input === "q") onExit();
    },
    { isActive: drilled === null },
  );

  if (drilled !== null) {
    return <Report report={drilled} onExit={() => setDrilledIndex(null)} exitHint="esc back" />;
  }

  const longestNameLength = Math.max(
    0,
    ...summary.projects.map((project) => project.projectName.length),
  );
  const width = Math.max(24, columns - 2);
  const visibleProjects = summary.projects.slice(visibleStart, visibleEnd);

  return (
    <Box flexDirection="column">
      <ScoreHeader
        score={summary.aggregateScore}
        projectedScore={summary.projectedScore}
        projectName={summary.projectName}
        issueCount={summary.combinedDiagnostics.length}
        noScoreMessage={summary.noScoreMessage}
      />
      <Box marginTop={1}>
        <CategoryBreakdown diagnostics={summary.combinedDiagnostics} />
      </Box>
      <Box flexDirection="column" height={listHeight} marginTop={1}>
        {visibleProjects.map((project, index) => {
          const isSelected = visibleStart + index === selectedIndex;
          const errorCount = project.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "error",
          ).length;
          const warningCount = project.diagnostics.length - errorCount;
          const score = project.score?.score ?? null;
          return (
            <Text key={project.rootDirectory} wrap="truncate-end">
              <Text color={score !== null ? scoreColorName(score) : undefined}>
                {isSelected ? "› " : "  "}
              </Text>
              <Text color={score !== null ? scoreColorName(score) : undefined} bold={isSelected}>
                {project.projectName.padEnd(longestNameLength)}
              </Text>
              {score !== null ? (
                <Text color={scoreColorName(score)}>
                  {"  "}
                  {String(score).padStart(3)} {scoreBandLabel(score)}
                </Text>
              ) : (
                <Text dimColor>{"  no score"}</Text>
              )}
              <Text dimColor>{"   "}</Text>
              {errorCount > 0 ? <Text color="red">{pluralize(errorCount, "error")}</Text> : null}
              {errorCount > 0 && warningCount > 0 ? <Text dimColor>, </Text> : null}
              {warningCount > 0 ? (
                <Text color="yellow">{pluralize(warningCount, "warning")}</Text>
              ) : null}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Text wrap="truncate-end">
        <Text bold>{pluralize(summary.projects.length, "project")}</Text>
        <Text dimColor>
          {"   "}
          {selectedIndex + 1}/{summary.projects.length} · ↑↓ move · enter open · q quit
        </Text>
      </Text>
    </Box>
  );
};
