/**
 * Client-side dart scoring — mirrors backend detection.py exactly.
 *
 * Used to re-score a dart after the user drags its tip in adjust mode.
 */

import { type Matrix3x3, transformPoint } from "./homography";

// ── Board geometry (identical to backend & dartboard-geometry.ts) ────────────

const BOARD_NUMBERS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

const SEG_DEG = 360 / 20; // 18° per segment

const RADII = {
  innerBull: 6.35,
  outerBull: 15.9,
  tripleInner: 97,
  tripleOuter: 107,
  doubleInner: 160,
  doubleOuter: 170,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function angleFrom12CW(x: number, y: number): number {
  let angle = (Math.atan2(x, -y) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return angle;
}

function segmentNumber(angleDeg: number): number {
  const idx = Math.floor(((angleDeg + SEG_DEG / 2) % 360) / SEG_DEG);
  return BOARD_NUMBERS[idx];
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface ScoringResult {
  value: number;
  label: string;
  segmentId: string;
  boardX: number;
  boardY: number;
}

/**
 * Score a dart from perfect-board mm coordinates.
 */
export function scoreFromBoardCoords(
  bx: number,
  by: number,
): { value: number; label: string; segmentId: string } {
  const r = Math.sqrt(bx * bx + by * by);

  if (r <= RADII.innerBull) return { value: 50, label: "D-BULL", segmentId: "inner-bull" };
  if (r <= RADII.outerBull) return { value: 25, label: "BULL", segmentId: "outer-bull" };
  if (r > RADII.doubleOuter) return { value: 0, label: "MISS", segmentId: "miss" };

  const angle = angleFrom12CW(bx, by);
  const num = segmentNumber(angle);

  if (r >= RADII.tripleInner && r <= RADII.tripleOuter)
    return { value: num * 3, label: `T${num}`, segmentId: `t-${num}` };
  if (r >= RADII.doubleInner && r <= RADII.doubleOuter)
    return { value: num * 2, label: `D${num}`, segmentId: `d-${num}` };
  if (r < RADII.tripleInner)
    return { value: num, label: String(num), segmentId: `is-${num}` };
  return { value: num, label: String(num), segmentId: `os-${num}` };
}

/**
 * Full pipeline: transform a tip pixel coordinate through the calibration
 * homography and score it.
 *
 * @param calibrationMatrix  3×3 homography (camera px → board mm)
 * @param tipPx              Tip position in camera pixel coordinates
 */
export function scoreFromPixel(
  calibrationMatrix: Matrix3x3,
  tipPx: { x: number; y: number },
): ScoringResult {
  const board = transformPoint(calibrationMatrix, tipPx);
  const { value, label, segmentId } = scoreFromBoardCoords(board.x, board.y);
  return { value, label, segmentId, boardX: board.x, boardY: board.y };
}
