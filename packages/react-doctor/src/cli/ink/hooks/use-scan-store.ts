import { useSyncExternalStore } from "react";
import type { ScanStore, ScanStoreSnapshot } from "../scan-store.js";

/** Subscribes the Ink tree to the Effect-driven scan store. */
export const useScanStore = (store: ScanStore): ScanStoreSnapshot =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
