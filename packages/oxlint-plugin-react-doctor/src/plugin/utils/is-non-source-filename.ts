// Bundled / minified / vendored output is not actionable source — renames
// and derefs there are build-time artifacts, not author decisions.
const NON_SOURCE_FILENAME_MARKERS = ["/dist/", "/build/", ".min.", ".umd.", "/.yalc/", "/vendor/"];

export const isNonSourceFilename = (filename: string): boolean =>
  NON_SOURCE_FILENAME_MARKERS.some((marker) => filename.includes(marker));
