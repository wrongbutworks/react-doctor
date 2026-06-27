import { DIAGNOSTIC_CATEGORY_BUCKETS } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

/** One category row in the breakdown: its error / warning counts. */
export interface CategoryTally {
  readonly category: string;
  readonly errorCount: number;
  readonly warningCount: number;
}

// Fixed display order (Security first), mirroring the CLI's category breakdown
// so the reader scans to a category by position, not by the day's weighting.
const CATEGORY_RANK = new Map<string, number>(
  DIAGNOSTIC_CATEGORY_BUCKETS.map((category, index) => [category, index]),
);

const rankOf = (category: string): number => CATEGORY_RANK.get(category) ?? Number.MAX_SAFE_INTEGER;

/**
 * Groups diagnostics into per-category error / warning tallies, ordered by the
 * canonical category display rank (unknown categories sort last, alphabetically).
 */
export const buildCategoryTallies = (diagnostics: ReadonlyArray<Diagnostic>): CategoryTally[] => {
  const tallyByCategory = new Map<string, { errorCount: number; warningCount: number }>();
  for (const diagnostic of diagnostics) {
    const tally = tallyByCategory.get(diagnostic.category) ?? { errorCount: 0, warningCount: 0 };
    if (diagnostic.severity === "error") tally.errorCount += 1;
    else tally.warningCount += 1;
    tallyByCategory.set(diagnostic.category, tally);
  }

  return [...tallyByCategory.entries()]
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((tallyA, tallyB) => {
      const rankDelta = rankOf(tallyA.category) - rankOf(tallyB.category);
      return rankDelta !== 0 ? rankDelta : tallyA.category.localeCompare(tallyB.category);
    });
};
