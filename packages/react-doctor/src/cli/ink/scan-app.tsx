import { useApp } from "ink";
import { Report } from "./components/report.js";
import { Scanning } from "./components/scanning.js";
import { Summary } from "./components/summary.js";
import { useScanStore } from "./hooks/use-scan-store.js";
import type { ScanStore } from "./scan-store.js";

export interface ScanAppProps {
  readonly store: ScanStore;
}

const RECENT_LIVE_COUNT = 8;

/** Root of the interactive scan UI: routes the store phase to a view. */
export const ScanApp = ({ store }: ScanAppProps) => {
  const snapshot = useScanStore(store);
  const { exit } = useApp();

  if (snapshot.phase === "summary" && snapshot.summary) {
    return <Summary summary={snapshot.summary} onExit={() => exit()} />;
  }

  if (snapshot.phase === "report" && snapshot.report) {
    return <Report report={snapshot.report} onExit={() => exit()} />;
  }

  return (
    <Scanning
      progressText={snapshot.progress?.text ?? null}
      liveCount={snapshot.liveCount}
      recent={snapshot.liveDiagnostics.slice(-RECENT_LIVE_COUNT)}
    />
  );
};
