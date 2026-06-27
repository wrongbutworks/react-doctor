import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import {
  buildRulePriorityMap,
  buildSortedRuleGroups,
  formatLearnMoreLine,
} from "../../utils/diagnostic-grouping.js";
import type { Severity } from "./severity-variants.js";

/** One scannable row in the diagnostics list: a fully-sorted rule group. */
export interface DiagnosticRow {
  readonly ruleKey: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly severity: Severity;
  readonly category: string;
  readonly title: string;
  /** `file:line` for the representative site (or just `file` when line-less). */
  readonly location: string;
  readonly siteCount: number;
  readonly representative: Diagnostic;
  readonly learnMore: string | null;
}

const pickRepresentative = (diagnostics: ReadonlyArray<Diagnostic>): Diagnostic =>
  diagnostics.find((diagnostic) => diagnostic.line > 0) ?? diagnostics[0];

const formatLocation = (diagnostic: Diagnostic): string =>
  diagnostic.line > 0 ? `${diagnostic.filePath}:${diagnostic.line}` : diagnostic.filePath;

/**
 * Projects the settled diagnostics into the full, score-priority-sorted list of
 * rule-group rows — no top-N truncation. The TUI viewport handles the volume.
 */
export const buildDiagnosticRows = (
  diagnostics: ReadonlyArray<Diagnostic>,
  score: ScoreResult | null,
): DiagnosticRow[] => {
  const rulePriority = buildRulePriorityMap([score]);
  return buildSortedRuleGroups(diagnostics, rulePriority).map(([ruleKey, ruleDiagnostics]) => {
    const representative = pickRepresentative(ruleDiagnostics);
    return {
      ruleKey,
      diagnostics: ruleDiagnostics,
      severity: representative.severity === "error" ? "error" : "warning",
      category: representative.category,
      title: representative.title ?? ruleKey,
      location: formatLocation(representative),
      siteCount: ruleDiagnostics.length,
      representative,
      learnMore: formatLearnMoreLine(representative),
    };
  });
};
