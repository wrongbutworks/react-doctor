import type { MultiProjectSummary, ScanReport } from "../scan-store.js";
import { Report } from "./report.js";

export interface SummaryProps {
  readonly summary: MultiProjectSummary;
  readonly onExit: () => void;
}

/**
 * The monorepo view: one flat, scrollable list of every project's findings —
 * no per-folder drill-in. Each row's location is already qualified with its
 * project folder (rewritten relative to the monorepo root in `runScanApp`), and
 * the shared root resolves every code frame, so this is just the single-project
 * `Report` fed the combined diagnostics plus the aggregate (worst) score.
 */
export const Summary = ({ summary, onExit }: SummaryProps) => {
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
  return <Report report={report} onExit={onExit} projectCount={summary.projects.length} />;
};
