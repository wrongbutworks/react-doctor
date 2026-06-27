import type { Diagnostic, ScoreResult } from "@react-doctor/core";
// The live feed carries diagnostics exactly as `Reporter.emit` produces them
// (the schema class), which differs from the index `Diagnostic` type only in
// nested-array readonly-ness. The settled `report` keeps the index type.
import type { Diagnostic as LiveDiagnostic } from "@react-doctor/core/schemas";

export type ScanPhase = "scanning" | "report" | "summary" | "done";

export type ProgressStatus = "active" | "succeeded" | "failed";

export interface ProgressState {
  readonly text: string;
  readonly status: ProgressStatus;
}

/** The settled single-project scan output the report view renders. */
export interface ScanReport {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  /** Score reachable by fixing the top errors (the bar's ghost gain), or null. */
  readonly projectedScore: number | null;
  readonly projectName: string;
  /** Absolute scan root, used to read source for the inline code frame. */
  readonly rootDirectory: string;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
  /** True when the share URL is suppressed (--no-score / share off / CI). */
  readonly isOffline: boolean;
  /** Shown in place of the score header when `score` is null. */
  readonly noScoreMessage: string;
}

/** A monorepo scan: per-project reports plus the aggregate (worst) score. */
export interface MultiProjectSummary {
  readonly projects: ReadonlyArray<ScanReport>;
  /** The worst project's score — a chain is only as strong as its weakest link. */
  readonly aggregateScore: ScoreResult | null;
  readonly projectedScore: number | null;
  /** Every project's diagnostics, for the combined category breakdown + share. */
  readonly combinedDiagnostics: ReadonlyArray<Diagnostic>;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
  readonly projectName: string;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
}

export interface ScanStoreSnapshot {
  readonly phase: ScanPhase;
  /** Diagnostics as the orchestrator emits them, before the final sort/score. */
  readonly liveDiagnostics: ReadonlyArray<LiveDiagnostic>;
  readonly liveCount: number;
  /** Latest scan-progress line, or `null` once the scan stops without a result. */
  readonly progress: ProgressState | null;
  /** Settled single-project output, present once a single-project scan resolves. */
  readonly report: ScanReport | null;
  /** Settled monorepo output, present once a multi-project scan resolves. */
  readonly summary: MultiProjectSummary | null;
}

/**
 * The single boundary between the Effect-driven scan and the Ink render tree.
 * Writers run on the Effect side (the store-backed `Reporter` / `Progress`
 * layers and the command after `inspect()` resolves); the Ink app reads the
 * immutable snapshot through React's `useSyncExternalStore`. Each writer swaps
 * the snapshot reference so React only re-renders on real changes.
 */
export interface ScanStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ScanStoreSnapshot;
  readonly emitDiagnostic: (diagnostic: LiveDiagnostic) => void;
  readonly setProgress: (progress: ProgressState | null) => void;
  readonly setReport: (report: ScanReport) => void;
  readonly setSummary: (summary: MultiProjectSummary) => void;
  readonly setPhase: (phase: ScanPhase) => void;
}

const INITIAL_SNAPSHOT: ScanStoreSnapshot = {
  phase: "scanning",
  liveDiagnostics: [],
  liveCount: 0,
  progress: null,
  report: null,
  summary: null,
};

export const createScanStore = (): ScanStore => {
  let snapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  const commit = (next: ScanStoreSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    emitDiagnostic: (diagnostic) =>
      commit({
        ...snapshot,
        liveDiagnostics: [...snapshot.liveDiagnostics, diagnostic],
        liveCount: snapshot.liveCount + 1,
      }),
    setProgress: (progress) => commit({ ...snapshot, progress }),
    setReport: (report) => commit({ ...snapshot, report, phase: "report" }),
    setSummary: (summary) => commit({ ...snapshot, summary, phase: "summary" }),
    setPhase: (phase) => commit({ ...snapshot, phase }),
  };
};
