import { Box, Text } from "ink";

export interface DiagnosticActionMenuProps {
  /** The selected issue's title, shown as the modal heading for context. */
  readonly title: string;
  /** Action labels in order — Copy first, then each launchable agent. */
  readonly itemLabels: ReadonlyArray<string>;
  readonly focusedIndex: number;
  /** Upper bound for the modal width; it centers within the report. */
  readonly maxWidth: number;
}

const MODAL_TARGET_WIDTH = 44;
const MODAL_MIN_WIDTH = 24;
// ANSI palette colors (not hex) so the card inherits the user's terminal theme:
// an opaque `black` surface hides the code frame behind it, and a high-contrast
// `white` bar (with black text) marks the focused row.
const MODAL_BACKGROUND = "black";
const MODAL_SELECTED_BACKGROUND = "white";

/**
 * The triage action modal: a centered, opaque card floated over the report
 * while the menu is open. Lists the actions as a vertical menu — copy a focused
 * fix prompt or hand it to a detected CLI agent — with the focused row drawn as
 * a full-width selection bar; navigated with `↑/↓`, chosen with Enter, dismissed
 * with Esc.
 */
export const DiagnosticActionMenu = ({
  title,
  itemLabels,
  focusedIndex,
  maxWidth,
}: DiagnosticActionMenuProps) => {
  const width = Math.max(MODAL_MIN_WIDTH, Math.min(MODAL_TARGET_WIDTH, maxWidth));
  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor="gray"
      backgroundColor={MODAL_BACKGROUND}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
    >
      <Text wrap="truncate-end">
        <Text dimColor>Fix </Text>
        <Text bold>{title}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {itemLabels.map((label, index) => {
          const isFocused = index === focusedIndex;
          // Each row is its own Box so the selection color fills the full
          // stretched width (a bar), not just the label's length.
          return (
            <Box key={label} backgroundColor={isFocused ? MODAL_SELECTED_BACKGROUND : undefined}>
              <Text wrap="truncate-end" bold={isFocused} color={isFocused ? "black" : "gray"}>
                {isFocused ? "› " : "  "}
                {label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">
          ↑/↓ select · enter run · esc close
        </Text>
      </Box>
    </Box>
  );
};
