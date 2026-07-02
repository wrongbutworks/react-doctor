/** The bare `file:line` (or just `file` when line-less) text for a site. */
export const formatDiagnosticSite = (site: { filePath: string; line: number }): string =>
  site.line > 0 ? `${site.filePath}:${site.line}` : site.filePath;
