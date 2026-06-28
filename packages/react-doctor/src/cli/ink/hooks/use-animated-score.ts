import { useEffect, useState } from "react";
import {
  SCORE_HEADER_ANIMATION_FRAME_COUNT,
  SCORE_HEADER_ANIMATION_FRAME_DELAY_MS,
  SCORE_PROJECTION_FRAME_COUNT,
  SCORE_PROJECTION_FRAME_DELAY_MS,
} from "../../utils/constants.js";
import { easeOutCubic } from "../../utils/ease-out-cubic.js";

export interface UseAnimatedScoreOptions {
  readonly score: number;
  /** Score reachable by fixing the top errors (the bar's ghost gain), or null. */
  readonly projectedScore: number | null;
  /** When false, returns the final values immediately (tests / non-TTY). */
  readonly animate: boolean;
}

export interface AnimatedScore {
  /** Counts up from 0 to `score`, eased. */
  readonly displayScore: number;
  /** Grows from `score` to `projectedScore` once the count-up settles; null when no gain. */
  readonly displayProjectedScore: number | null;
}

/**
 * Drives the score header's reveal: the number counts up while the bar fills
 * (ease-out cubic), then the projection "ghost gain" grows in — the Ink mirror
 * of the static CLI's `printAnimatedScore` / `animateScoreProjection`.
 */
export const useAnimatedScore = ({
  score,
  projectedScore,
  animate,
}: UseAnimatedScoreOptions): AnimatedScore => {
  const hasProjection = projectedScore !== null && projectedScore > score;
  const [displayScore, setDisplayScore] = useState(animate ? 0 : score);
  const [displayProjectedScore, setDisplayProjectedScore] = useState<number | null>(
    animate ? null : hasProjection ? projectedScore : null,
  );

  useEffect(() => {
    if (!animate) {
      setDisplayScore(score);
      setDisplayProjectedScore(hasProjection ? projectedScore : null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    // Phase 2: grow the projection ghost from the real score to its potential.
    const runProjection = (): void => {
      let frame = 1;
      const tick = (): void => {
        const progress = easeOutCubic(frame / SCORE_PROJECTION_FRAME_COUNT);
        setDisplayProjectedScore(score + (projectedScore! - score) * progress);
        if (frame < SCORE_PROJECTION_FRAME_COUNT) {
          frame += 1;
          timeoutId = setTimeout(tick, SCORE_PROJECTION_FRAME_DELAY_MS);
        } else {
          setDisplayProjectedScore(projectedScore);
        }
      };
      tick();
    };

    // Phase 1: count the score up while the bar fills.
    let frame = 0;
    const tick = (): void => {
      const progress = easeOutCubic(frame / SCORE_HEADER_ANIMATION_FRAME_COUNT);
      setDisplayScore(Math.round(score * progress));
      if (frame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
        frame += 1;
        timeoutId = setTimeout(tick, SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
        return;
      }
      setDisplayScore(score);
      if (hasProjection) runProjection();
    };
    tick();

    return () => clearTimeout(timeoutId);
  }, [animate, score, projectedScore, hasProjection]);

  return { displayScore, displayProjectedScore };
};
