import path from "node:path";
import figures from "figures";
import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspacePackage } from "@react-doctor/core";
import { useExitOnCtrlC } from "../hooks/use-exit-on-ctrl-c.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { fuzzyMatch } from "../lib/fuzzy-match.js";

export interface ProjectSelectProps {
  readonly packages: ReadonlyArray<WorkspacePackage>;
  readonly rootDirectory: string;
  /** Receives the chosen directories; an empty array means the user cancelled. */
  readonly onSubmit: (directories: string[]) => void;
}

type SelectMode = "list" | "search";

interface ScoredPackage {
  readonly workspacePackage: WorkspacePackage;
  readonly matchedIndices: ReadonlyArray<number>;
}

// The header + the keymap hint always show; the filter/search line is only
// reserved when present. Subtracted from the terminal height so a long workspace
// scrolls instead of overflowing.
const BASE_CHROME_ROWS = 2;
const MIN_LIST_ROWS = 1;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

// Accept a run of printable chars so both per-keystroke typing and a paste land
// in the filter (control/escape sequences are caught by the key checks first).
const isPrintable = (input: string): boolean =>
  input.length > 0 && [...input].every((char) => char.charCodeAt(0) >= 32);

// Render the project name with its fuzzy-matched chars lit up, so it's clear why
// a result survived the filter.
const renderName = (
  name: string,
  matchedIndices: ReadonlyArray<number>,
  isSelected: boolean,
): ReactNode => {
  if (matchedIndices.length === 0) {
    return (
      <Text bold={isSelected} wrap="truncate-end">
        {name}
      </Text>
    );
  }
  const matched = new Set(matchedIndices);
  return (
    <Text bold={isSelected} wrap="truncate-end">
      {[...name].map((char, index) =>
        matched.has(index) ? (
          <Text key={index} color="yellow">
            {char}
          </Text>
        ) : (
          char
        ),
      )}
    </Text>
  );
};

/**
 * Interactive multiselect for a monorepo's projects — a compact flat list that
 * navigates by default and only filters when you opt in. `/` enters search
 * (type to fuzzy-filter, matched chars highlighted; `Enter` keeps the filter,
 * `Esc` clears it). In the list, `space` toggles a row, `a` toggles all, `Enter`
 * scans the checked set (or the highlighted row when none are), and `Esc` backs
 * out a level (filter → selection → cancel). The footer states what `Enter` does.
 */
export const ProjectSelect = ({ packages, rootDirectory, onSubmit }: ProjectSelectProps) => {
  const { rows: terminalRows } = useStdoutDimensions();
  useExitOnCtrlC();

  const [mode, setMode] = useState<SelectMode>("list");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  const matches = useMemo<ReadonlyArray<ScoredPackage>>(() => {
    const scored = packages.flatMap((workspacePackage) => {
      const result = fuzzyMatch(query, workspacePackage.name);
      return result ? [{ workspacePackage, result }] : [];
    });
    if (query.length > 0) scored.sort((a, b) => b.result.score - a.result.score);
    return scored.map(({ workspacePackage, result }) => ({
      workspacePackage,
      matchedIndices: result.matchedIndices,
    }));
  }, [packages, query]);

  const isSearching = mode === "search";
  const hasFilterLine = isSearching || query.length > 0;
  const listHeight = Math.max(
    MIN_LIST_ROWS,
    Math.min(
      Math.max(matches.length, 1),
      terminalRows - BASE_CHROME_ROWS - (hasFilterLine ? 1 : 0),
    ),
  );

  const boundedSelected = matches.length === 0 ? 0 : clamp(selectedIndex, 0, matches.length - 1);
  const current = matches[boundedSelected]?.workspacePackage;

  const setFilter = (next: string): void => {
    setQuery(next);
    setSelectedIndex(0);
    setOffset(0);
  };

  const move = (delta: number): void => {
    if (matches.length === 0) return;
    const next = clamp(boundedSelected + delta, 0, matches.length - 1);
    setSelectedIndex(next);
    setOffset((current) => {
      if (next < current) return next;
      if (next >= current + listHeight) return next - listHeight + 1;
      return current;
    });
  };

  const toggleChecked = (directory: string): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  };

  // The caller (promptProjectSelection) clears the picker's frame and unmounts
  // the Ink instance; doing it there — while the instance is still mounted —
  // is what lets `clear()` actually erase the footer/list from scrollback.
  const submit = (directories: ReadonlyArray<string>): void => {
    onSubmit([...directories]);
  };

  const scanSelection = (): void => {
    if (checked.size > 0) {
      return submit(
        packages.filter((pkg) => checked.has(pkg.directory)).map((pkg) => pkg.directory),
      );
    }
    if (current) submit([current.directory]);
  };

  useInput((input, key) => {
    if (isSearching) {
      // Search mode: typing filters; Enter keeps the filter, Esc clears it,
      // both return to the list. Arrows still move so you can aim mid-search.
      if (key.return) return setMode("list");
      if (key.escape) {
        setFilter("");
        return setMode("list");
      }
      if (key.downArrow || (key.ctrl && input === "n")) return move(1);
      if (key.upArrow || (key.ctrl && input === "p")) return move(-1);
      if (key.backspace || key.delete) return setFilter(query.slice(0, -1));
      if (isPrintable(input) && !key.ctrl && !key.meta) setFilter(query + input);
      return;
    }

    if (input === "/") return setMode("search");
    if (input === " ") {
      if (current) toggleChecked(current.directory);
      return;
    }
    if (input === "a") {
      setChecked((current) =>
        matches.every((match) => current.has(match.workspacePackage.directory))
          ? new Set()
          : new Set(matches.map((match) => match.workspacePackage.directory)),
      );
      return;
    }
    if (input === "q") return submit([]);
    // Esc backs out a level: clear the filter, then the selection, then cancel.
    if (key.escape) {
      if (query.length > 0) return setFilter("");
      if (checked.size > 0) return setChecked(new Set());
      return submit([]);
    }
    if (key.return) return scanSelection();
    if (key.downArrow || input === "j") return move(1);
    if (key.upArrow || input === "k") return move(-1);
    if (key.pageDown) return move(listHeight);
    if (key.pageUp) return move(-listHeight);
  });

  const maxOffset = Math.max(0, matches.length - listHeight);
  const visibleStart = Math.min(offset, maxOffset);
  const visibleMatches = matches.slice(visibleStart, visibleStart + listHeight);
  const longestNameLength = Math.max(
    0,
    ...packages.map((workspacePackage) => workspacePackage.name.length),
  );

  // The footer's Enter clause states exactly what will run, so the empty-set
  // fallback (scan the highlighted row) is never a surprise.
  const enterAction =
    checked.size === 0
      ? current
        ? `scan ${current.name}`
        : "scan"
      : checked.size === packages.length
        ? `scan all · ${checked.size}`
        : `scan ${checked.size} selected`;

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>Select projects to scan</Text>
        <Text dimColor>
          {"  "}
          {checked.size}/{packages.length}
        </Text>
      </Text>
      {isSearching ? (
        <Text wrap="truncate-end">
          <Text color="cyan">{"/ "}</Text>
          {query.length > 0 ? <Text>{query}</Text> : null}
          <Text inverse> </Text>
        </Text>
      ) : query.length > 0 ? (
        <Text dimColor wrap="truncate-end">
          {`filter: ${query}`}
        </Text>
      ) : null}
      <Box flexDirection="column" height={listHeight}>
        {matches.length === 0 ? (
          <Text dimColor>No matching projects</Text>
        ) : (
          visibleMatches.map((match, index) => {
            const matchIndex = visibleStart + index;
            const isSelected = matchIndex === boundedSelected;
            const isChecked = checked.has(match.workspacePackage.directory);
            return (
              <Text key={match.workspacePackage.directory} wrap="truncate-end">
                <Text color={isSelected ? "cyan" : undefined}>
                  {isSelected ? `${figures.pointer} ` : "  "}
                </Text>
                <Text color={isChecked ? "green" : undefined}>
                  {isChecked ? `${figures.radioOn} ` : `${figures.radioOff} `}
                </Text>
                {renderName(match.workspacePackage.name, match.matchedIndices, isSelected)}
                <Text dimColor>
                  {" ".repeat(longestNameLength - match.workspacePackage.name.length + 2)}
                  {path.relative(rootDirectory, match.workspacePackage.directory) || "."}
                </Text>
              </Text>
            );
          })
        )}
      </Box>
      <Text dimColor wrap="truncate-end">
        {isSearching
          ? "type to filter · enter confirm · esc clear"
          : "space select · a all · / search · "}
        {isSearching ? null : <Text color="cyan">enter</Text>}
        {isSearching ? null : ` ${enterAction} · q cancel`}
      </Text>
    </Box>
  );
};
