export interface FuzzyMatchResult {
  /** Higher is a better match; used to rank results. */
  readonly score: number;
  /** Indices in the target that matched, for highlighting. */
  readonly matchedIndices: ReadonlyArray<number>;
}

// Scoring weights, tuned so contiguous runs and word-start hits (the chars a
// human aims for) win, and earlier matches edge out later ones.
const CONSECUTIVE_BONUS = 5;
const WORD_BOUNDARY_BONUS = 10;
const LEADING_PENALTY = 1;

const isWordBoundaryBefore = (target: string, index: number): boolean => {
  if (index === 0) return true;
  const previous = target[index - 1];
  return previous === "-" || previous === "_" || previous === "/" || previous === " ";
};

/**
 * A small subsequence fuzzy matcher (fzf-style): every query char must appear in
 * order in the target, scored so contiguous and word-boundary hits rank highest.
 * Returns `null` when the query is not a subsequence. An empty query matches
 * everything with a neutral score, preserving the source order.
 */
export const fuzzyMatch = (query: string, target: string): FuzzyMatchResult | null => {
  if (query.length === 0) return { score: 0, matchedIndices: [] };

  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const matchedIndices: number[] = [];
  let score = 0;
  let queryIndex = 0;
  let previousMatchIndex = -2;

  for (
    let targetIndex = 0;
    targetIndex < lowerTarget.length && queryIndex < lowerQuery.length;
    targetIndex++
  ) {
    if (lowerTarget[targetIndex] !== lowerQuery[queryIndex]) continue;
    matchedIndices.push(targetIndex);
    if (targetIndex === previousMatchIndex + 1) score += CONSECUTIVE_BONUS;
    if (isWordBoundaryBefore(target, targetIndex)) score += WORD_BOUNDARY_BONUS;
    previousMatchIndex = targetIndex;
    queryIndex++;
  }

  if (queryIndex < lowerQuery.length) return null;
  score -= matchedIndices[0] * LEADING_PENALTY;
  return { score, matchedIndices };
};
