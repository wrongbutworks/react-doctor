import { DIAGNOSTIC_CATEGORY_BUCKETS } from "@react-doctor/core";
import type { DiagnosticRow } from "./diagnostic-rows.js";

/** A category title line in the grouped list (not selectable). */
export interface DiagnosticHeaderEntry {
  readonly kind: "header";
  readonly category: string;
  readonly errorCount: number;
  readonly warningCount: number;
}

/** A selectable rule-group row, rendered indented under its category header. */
export interface DiagnosticItemEntry {
  readonly kind: "item";
  readonly row: DiagnosticRow;
}

export type DiagnosticListEntry = DiagnosticHeaderEntry | DiagnosticItemEntry;

// Fixed category display order (Security first), mirroring the CLI's grouped
// diagnostics and the breakdown strip so the reader scans to a category by
// position. Unknown categories (legacy / adopted) sort last, alphabetically.
const CATEGORY_RANK = new Map<string, number>(
  DIAGNOSTIC_CATEGORY_BUCKETS.map((category, index) => [category, index]),
);

const rankOf = (category: string): number => CATEGORY_RANK.get(category) ?? Number.MAX_SAFE_INTEGER;

/**
 * Flattens the priority-sorted rule rows into a category-grouped display list:
 * a header line per category (ordered by display rank) followed by its rows,
 * which keep their incoming priority order within the group. The header carries
 * the row's incoming order so the per-category rule ranking is preserved.
 */
export const buildDiagnosticListEntries = (
  rows: ReadonlyArray<DiagnosticRow>,
): DiagnosticListEntry[] => {
  const rowsByCategory = new Map<string, DiagnosticRow[]>();
  for (const row of rows) {
    const categoryRows = rowsByCategory.get(row.category) ?? [];
    categoryRows.push(row);
    rowsByCategory.set(row.category, categoryRows);
  }

  const orderedCategories = [...rowsByCategory.keys()].sort((categoryA, categoryB) => {
    const rankDelta = rankOf(categoryA) - rankOf(categoryB);
    return rankDelta !== 0 ? rankDelta : categoryA.localeCompare(categoryB);
  });

  const entries: DiagnosticListEntry[] = [];
  for (const category of orderedCategories) {
    const categoryRows = rowsByCategory.get(category) ?? [];
    let errorCount = 0;
    let warningCount = 0;
    for (const row of categoryRows) {
      if (row.severity === "error") errorCount += row.siteCount;
      else warningCount += row.siteCount;
    }
    entries.push({ kind: "header", category, errorCount, warningCount });
    for (const row of categoryRows) entries.push({ kind: "item", row });
  }
  return entries;
};
