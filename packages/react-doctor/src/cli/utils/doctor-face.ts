import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "@react-doctor/core";

/**
 * The doctor face for a score band — `[eyes, mouth]` glyph rows shared by the
 * static score header and the Ink one so the two renderers can't drift.
 */
export const doctorFace = (score: number): readonly [string, string] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};
