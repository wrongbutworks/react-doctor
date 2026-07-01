import type { CliAgentId } from "../../utils/launch-agent.js";
import type { MultiProjectSummary, ScanReport, TuiHandoffRequest } from "../scan-store.js";
import { Report } from "./report.js";

export interface SummaryProps {
  readonly summary: MultiProjectSummary;
  readonly onExit: () => void;
  /** Launchable CLI agents for the report's right-panel triage actions. */
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  /** Hands the selected issue's prompt to an agent; the caller exits + launches. */
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  /** True when this repo has no React Doctor CI workflow yet (shows the callout). */
  readonly canAddToCi?: boolean;
  /** Requests CI setup; the caller exits + scaffolds the workflow. */
  readonly onAddToCi?: () => void;
}

/**
 * The monorepo view: one flat, scrollable list of every project's findings —
 * no per-folder drill-in. Each row's location is already qualified with its
 * project folder (rewritten relative to the monorepo root in `runScanApp`), and
 * the shared root resolves every code frame, so this is just the single-project
 * `Report` fed the combined diagnostics plus the aggregate (worst) score.
 */
export const Summary = ({
  summary,
  onExit,
  launchableAgents,
  onHandoff,
  canAddToCi,
  onAddToCi,
}: SummaryProps) => {
  const report: ScanReport = {
    diagnostics: summary.combinedDiagnostics,
    score: summary.aggregateScore,
    projectedScore: summary.projectedScore,
    projectName: summary.projectName,
    rootDirectory: summary.rootDirectory,
    scannedFileCount: summary.scannedFileCount,
    elapsedMilliseconds: summary.elapsedMilliseconds,
    isOffline: summary.isOffline,
    noScoreMessage: summary.noScoreMessage,
  };
  return (
    <Report
      report={report}
      onExit={onExit}
      launchableAgents={launchableAgents}
      onHandoff={onHandoff}
      canAddToCi={canAddToCi}
      onAddToCi={onAddToCi}
      projectCount={summary.projects.length}
    />
  );
};
