import { useInput } from "ink";
import { useRef, useState } from "react";

export interface ScrollViewport {
  readonly selectedIndex: number;
  /** First visible item index (inclusive). */
  readonly visibleStart: number;
  /** Last visible item index (exclusive). */
  readonly visibleEnd: number;
}

export interface UseScrollViewportOptions {
  readonly itemCount: number;
  readonly height: number;
  readonly isActive?: boolean;
  /**
   * When set, navigation only ever lands on indices for which this returns true
   * — used to skip non-selectable rows like category headers in a grouped list.
   * The viewport window still counts every row (headers included) so the height
   * math stays in terminal-line units.
   */
  readonly isSelectable?: (index: number) => boolean;
}

const HALF = 2;

/**
 * Headless scroll + selection over a uniform-height list, with a vim/less-style
 * keymap (↑↓ / j k, PgUp·PgDn, Ctrl-u·d half-page, gg·G). Owns no
 * rendering — components read the visible window and the selected index. This is
 * the cmdk-style "logic, not chrome" core the `<DiagnosticList>` builds on.
 */
export const useScrollViewport = (options: UseScrollViewportOptions): ScrollViewport => {
  const { itemCount, height, isActive = true, isSelectable } = options;

  const canSelect = (index: number): boolean =>
    index >= 0 && index < itemCount && (isSelectable ? isSelectable(index) : true);

  // First selectable index from `start`, scanning in `step` direction (±1).
  const seekSelectable = (start: number, step: number): number => {
    for (let index = start; index >= 0 && index < itemCount; index += step) {
      if (canSelect(index)) return index;
    }
    return -1;
  };

  // Nearest selectable index to `target`, preferring `step` then reversing — so
  // moving down onto a header lands on the next item, and there's no way to
  // strand the selection on a non-selectable row.
  const nearestSelectable = (target: number, step: number): number => {
    const ahead = seekSelectable(target, step);
    if (ahead !== -1) return ahead;
    const behind = seekSelectable(target, -step);
    return behind === -1 ? target : behind;
  };

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const first = seekSelectable(0, 1);
    return first === -1 ? 0 : first;
  });
  const [offset, setOffset] = useState(0);
  const awaitingSecondG = useRef(false);

  const clampIndex = (index: number): number => Math.max(0, Math.min(itemCount - 1, index));

  const moveTo = (rawIndex: number, step: number): void => {
    const next = nearestSelectable(clampIndex(rawIndex), step);
    setSelectedIndex(next);
    setOffset((current) => {
      if (next < current) return next;
      if (next >= current + height) return next - height + 1;
      return current;
    });
  };

  useInput(
    (input, key) => {
      if (itemCount === 0) return;
      const isSecondG = awaitingSecondG.current && input === "g";
      if (input !== "g") awaitingSecondG.current = false;

      if (key.downArrow || input === "j") return moveTo(selectedIndex + 1, 1);
      if (key.upArrow || input === "k") return moveTo(selectedIndex - 1, -1);
      if (key.pageDown) return moveTo(selectedIndex + height, 1);
      if (key.pageUp) return moveTo(selectedIndex - height, -1);
      if (key.ctrl && input === "d") return moveTo(selectedIndex + Math.floor(height / HALF), 1);
      if (key.ctrl && input === "u") return moveTo(selectedIndex - Math.floor(height / HALF), -1);
      if (input === "G") return moveTo(itemCount - 1, -1);
      if (isSecondG) {
        awaitingSecondG.current = false;
        return moveTo(0, 1);
      }
      if (input === "g") {
        awaitingSecondG.current = true;
      }
    },
    { isActive },
  );

  // Re-clamp every render so a shrinking list can't strand the window past the
  // end, and re-resolve the selection so a changed list can't leave it on a
  // header or past the new end.
  const maxOffset = Math.max(0, itemCount - height);
  const visibleStart = Math.min(offset, maxOffset);
  const resolvedSelected = canSelect(selectedIndex)
    ? selectedIndex
    : nearestSelectable(clampIndex(selectedIndex), 1);
  return {
    selectedIndex: resolvedSelected,
    visibleStart,
    visibleEnd: Math.min(itemCount, visibleStart + height),
  };
};
