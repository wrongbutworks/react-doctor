import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "@react-doctor/core";

/** The Ink color name for a score, matching the CLI's green/yellow/red bands. */
export const scoreColorName = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "green";
  if (score >= SCORE_OK_THRESHOLD) return "yellow";
  return "red";
};
