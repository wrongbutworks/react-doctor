import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Diagnostic as LiveDiagnostic } from "@react-doctor/core/schemas";
import { severityVariant } from "../lib/severity-variants.js";

export interface ScanningProps {
  readonly progressText: string | null;
  readonly liveCount: number;
  readonly recent: ReadonlyArray<LiveDiagnostic>;
}

/** The live scan view: spinner, current phase, running count, and a tail of finds. */
export const Scanning = ({ progressText, liveCount, recent }: ScanningProps) => {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> {progressText ?? "Scanning…"}</Text>
        {liveCount > 0 ? (
          <Text dimColor>
            {"  ·  "}
            {liveCount} found
          </Text>
        ) : null}
      </Text>
      {recent.map((diagnostic, index) => {
        const variant = severityVariant(diagnostic.severity === "error" ? "error" : "warning");
        const location =
          diagnostic.line > 0 ? `${diagnostic.filePath}:${diagnostic.line}` : diagnostic.filePath;
        return (
          <Text key={`${diagnostic.filePath}:${diagnostic.line}:${index}`} wrap="truncate-end">
            {"  "}
            <Text color={variant.color}>{variant.icon}</Text>
            <Text> {diagnostic.title ?? `${diagnostic.plugin}/${diagnostic.rule}`}</Text>
            <Text dimColor>
              {"  "}
              {location}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
};
