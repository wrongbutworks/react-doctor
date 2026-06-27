import path from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import type { WorkspacePackage } from "@react-doctor/core";
import { useExitOnCtrlC } from "../hooks/use-exit-on-ctrl-c.js";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";

export interface ProjectSelectProps {
  readonly packages: ReadonlyArray<WorkspacePackage>;
  readonly rootDirectory: string;
  /** Receives the chosen directories; an empty array means the user cancelled. */
  readonly onSubmit: (directories: string[]) => void;
}

const HEADER_ROWS = 2;
const FOOTER_ROWS = 2;
const MIN_LIST_ROWS = 3;

/**
 * Interactive multiselect for a monorepo's projects — the Ink replacement for
 * the `prompts` multiselect. Space toggles, `a` toggles all, Enter scans the
 * selected set (falling back to the highlighted row when none are checked).
 */
export const ProjectSelect = ({ packages, rootDirectory, onSubmit }: ProjectSelectProps) => {
  const { rows: terminalRows, columns } = useStdoutDimensions();
  const { exit } = useApp();
  useExitOnCtrlC();
  // Default to all selected: Enter then scans the whole workspace, matching the
  // non-interactive "scan all" behavior — deselect to narrow.
  const [checked, setChecked] = useState<ReadonlySet<number>>(
    () => new Set(packages.map((_, index) => index)),
  );

  const listHeight = Math.max(MIN_LIST_ROWS, terminalRows - HEADER_ROWS - FOOTER_ROWS);
  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: packages.length,
    height: listHeight,
  });

  useInput((input, key) => {
    if (input === " ") {
      setChecked((current) => {
        const next = new Set(current);
        if (next.has(selectedIndex)) next.delete(selectedIndex);
        else next.add(selectedIndex);
        return next;
      });
      return;
    }
    if (input === "a") {
      setChecked((current) =>
        current.size === packages.length ? new Set() : new Set(packages.map((_, index) => index)),
      );
      return;
    }
    if (input === "q") {
      exit();
      onSubmit([]);
      return;
    }
    // Ink reports Enter via `key.return` (not a literal carriage return), matching
    // `useScrollViewport`. Checking the raw char misses Enter on most terminals.
    if (key.return) {
      const indices = checked.size > 0 ? [...checked] : [selectedIndex];
      exit();
      onSubmit(indices.map((index) => packages[index].directory));
    }
  });

  const width = Math.max(24, columns - 2);
  const visiblePackages = packages.slice(visibleStart, visibleEnd);

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Select projects</Text>
        <Text dimColor>
          {" "}
          {checked.size}/{packages.length} selected
        </Text>
      </Text>
      <Box flexDirection="column" height={listHeight} marginTop={1}>
        {visiblePackages.map((workspacePackage, index) => {
          const packageIndex = visibleStart + index;
          const isSelected = packageIndex === selectedIndex;
          const isChecked = checked.has(packageIndex);
          return (
            <Text key={workspacePackage.directory} wrap="truncate-end">
              <Text color={isSelected ? "cyan" : undefined}>{isSelected ? "› " : "  "}</Text>
              <Text color={isChecked ? "green" : undefined}>{isChecked ? "◉ " : "◯ "}</Text>
              <Text bold={isSelected}>{workspacePackage.name}</Text>
              <Text dimColor>
                {"  "}
                {path.relative(rootDirectory, workspacePackage.directory) || "."}
              </Text>
            </Text>
          );
        })}
      </Box>
      <Text dimColor wrap="truncate-end">
        {"─".repeat(width)}
      </Text>
      <Text dimColor>↑↓ move · space toggle · a all · enter scan · q cancel</Text>
    </Box>
  );
};
