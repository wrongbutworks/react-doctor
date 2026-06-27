import type { InspectResult } from "@react-doctor/core";

// Count UNIQUE scanned files by absolute path: nested workspace packages (a
// parent whose tree contains a child package) scan the shared files in BOTH
// projects, so naively summing per-project counts overstates the real total. A
// scan that reported no file paths can't be deduped, so it contributes its own
// reported count (this fallback is per-scan, not all-or-nothing — the other
// projects still dedupe against each other).
export const countUniqueScannedFiles = (results: ReadonlyArray<InspectResult>): number => {
  const uniqueScannedFilePaths = new Set<string>();
  let fileCountFromScansWithoutPaths = 0;
  for (const result of results) {
    const scannedFilePaths = result.scannedFilePaths;
    if (scannedFilePaths && scannedFilePaths.length > 0) {
      for (const filePath of scannedFilePaths) uniqueScannedFilePaths.add(filePath);
    } else {
      fileCountFromScansWithoutPaths += result.scannedFileCount ?? result.project.sourceFileCount;
    }
  }
  return uniqueScannedFilePaths.size + fileCountFromScansWithoutPaths;
};
