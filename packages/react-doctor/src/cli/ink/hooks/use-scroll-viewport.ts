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
  /** Fired on Enter for the selected index. */
  readonly onActivate?: (index: number) => void;
}

const HALF = 2;

/**
 * Headless scroll + selection over a uniform-height list, with a vim/less-style
 * keymap (↑↓ / j k, PgUp·PgDn, Ctrl-u·d half-page, gg·G, Enter). Owns no
 * rendering — components read the visible window and the selected index. This is
 * the cmdk-style "logic, not chrome" core the `<DiagnosticList>` builds on.
 */
export const useScrollViewport = (options: UseScrollViewportOptions): ScrollViewport => {
  const { itemCount, height, isActive = true, onActivate } = options;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const awaitingSecondG = useRef(false);

  const clampIndex = (index: number): number => Math.max(0, Math.min(itemCount - 1, index));

  const moveTo = (rawIndex: number): void => {
    const next = clampIndex(rawIndex);
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

      if (key.downArrow || input === "j") return moveTo(selectedIndex + 1);
      if (key.upArrow || input === "k") return moveTo(selectedIndex - 1);
      if (key.pageDown) return moveTo(selectedIndex + height);
      if (key.pageUp) return moveTo(selectedIndex - height);
      if (key.ctrl && input === "d") return moveTo(selectedIndex + Math.floor(height / HALF));
      if (key.ctrl && input === "u") return moveTo(selectedIndex - Math.floor(height / HALF));
      if (input === "G") return moveTo(itemCount - 1);
      if (isSecondG) {
        awaitingSecondG.current = false;
        return moveTo(0);
      }
      if (input === "g") {
        awaitingSecondG.current = true;
        return;
      }
      if (key.return && onActivate) onActivate(clampIndex(selectedIndex));
    },
    { isActive },
  );

  // Re-clamp every render so a shrinking list can't strand the window past the end.
  const maxOffset = Math.max(0, itemCount - height);
  const visibleStart = Math.min(offset, maxOffset);
  return {
    selectedIndex: clampIndex(selectedIndex),
    visibleStart,
    visibleEnd: Math.min(itemCount, visibleStart + height),
  };
};
