import { useApp } from "ink";
import type { CliAgentId } from "../utils/launch-agent.js";
import { Report } from "./components/report.js";
import { Scanning } from "./components/scanning.js";
import { Summary } from "./components/summary.js";
import { useScanStore } from "./hooks/use-scan-store.js";
import type { ScanStore, TuiHandoffRequest } from "./scan-store.js";

export interface ScanAppProps {
  readonly store: ScanStore;
  /** Launchable CLI agents for the report's right-panel triage actions. */
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  /** Records an agent handoff request the runner fulfills after the app exits. */
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  /** True when this repo has no React Doctor CI workflow yet (shows the callout). */
  readonly canAddToCi?: boolean;
  /** Records a CI-setup request the runner fulfills after the app exits. */
  readonly onAddToCi?: () => void;
}

const RECENT_LIVE_COUNT = 5;

/** Root of the interactive scan UI: routes the store phase to a view. */
export const ScanApp = ({
  store,
  launchableAgents,
  onHandoff,
  canAddToCi,
  onAddToCi,
}: ScanAppProps) => {
  const snapshot = useScanStore(store);
  const { exit } = useApp();

  if (snapshot.phase === "summary" && snapshot.summary) {
    return (
      <Summary
        summary={snapshot.summary}
        launchableAgents={launchableAgents}
        onHandoff={onHandoff}
        canAddToCi={canAddToCi}
        onAddToCi={onAddToCi}
        onExit={() => exit()}
      />
    );
  }

  if (snapshot.phase === "report" && snapshot.report) {
    return (
      <Report
        report={snapshot.report}
        launchableAgents={launchableAgents}
        onHandoff={onHandoff}
        canAddToCi={canAddToCi}
        onAddToCi={onAddToCi}
        onExit={() => exit()}
      />
    );
  }

  return (
    <Scanning
      progressText={snapshot.progress?.text ?? null}
      liveCount={snapshot.liveCount}
      recent={snapshot.liveDiagnostics.slice(-RECENT_LIVE_COUNT)}
    />
  );
};
