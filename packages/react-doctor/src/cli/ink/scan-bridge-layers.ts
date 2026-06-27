import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Progress, Reporter } from "@react-doctor/core";
import type { ProgressHandle } from "@react-doctor/core";
import type { ScanStore } from "./scan-store.js";

/**
 * `Reporter` side-channel that forwards every fully-filtered diagnostic
 * (across all sources, post per-element pipeline) into the scan store as the
 * orchestrator emits it — the live feed the Ink app renders while the scan
 * runs. The final sorted/scored list still rides the orchestrator's return
 * value, so `finalize` is a no-op here.
 */
export const reporterLayerForStore = (store: ScanStore): Layer.Layer<Reporter> =>
  Layer.succeed(
    Reporter,
    Reporter.of({
      emit: (diagnostic) => Effect.sync(() => store.emitDiagnostic(diagnostic)),
      finalize: Effect.void,
    }),
  );

/**
 * `ProgressHandle` factory backed by the scan store, fed to the existing
 * `Progress.layerOra` slot. Maps the orchestrator's spinner lifecycle onto
 * store progress state the Ink spinner reads, replacing the ora terminal
 * writes on the interactive path.
 */
export const progressHandleForStore =
  (store: ScanStore) =>
  (text: string): ProgressHandle => {
    store.setProgress({ text, status: "active" });
    return {
      update: (displayText) =>
        Effect.sync(() => store.setProgress({ text: displayText, status: "active" })),
      succeed: (displayText) =>
        Effect.sync(() => store.setProgress({ text: displayText, status: "succeeded" })),
      fail: (displayText) =>
        Effect.sync(() => store.setProgress({ text: displayText, status: "failed" })),
      stop: () => Effect.sync(() => store.setProgress(null)),
    };
  };

/** The store-backed `Progress` layer, reusing the injected-factory slot. */
export const progressLayerForStore = (store: ScanStore): Layer.Layer<Progress> =>
  Progress.layerOra(progressHandleForStore(store));
