import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "@react-doctor/core";

/** The short qualitative label for a score, shown next to the number. */
export const scoreBandLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "OK";
  return "Needs work";
};
