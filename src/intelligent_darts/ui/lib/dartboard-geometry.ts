/**
 * "Perfect board" geometry used for calibration wireframe overlay.
 *
 * Coordinate system:
 *   - Origin at the bull centre
 *   - x → right,  y → down  (screen convention)
 *   - All coordinates in mm (1 unit = 1 mm on a real board)
 *
 * Calibration uses 4 "double-ring corner" points — the intersections
 * of the double-ring outer wire with specific segment wires.  These
 * are easy to identify (where two wires cross) and sit at the very
 * edge of the scoring area.
 *
 * BDO / WDF standard measurements (mm from centre):
 *   Inner bull diameter:     12.7   →  radius  6.35
 *   Outer bull diameter:     31.8   →  radius 15.9
 *   Outside of outer treble wire:   107.4  (≈107)
 *   Outside of outer double wire:   170
 *   Treble / double ring inside measurement:  8 mm
 *
 * The "inside measurement" is the gap between wire INNER faces.
 * Wires have physical width (~1 mm on Blade boards).  The VISIBLE
 * scoring band spans from the outer edge of one wire to the outer
 * edge of the next:  gap + 2 × wire_width ≈ 10 mm.
 *
 * The radii below represent the wire OUTER edges (what you see):
 */

import { type Point, type Matrix3x3, transformPoint } from "./homography";

// ── Constants ───────────────────────────────────────────────────────────────

export const BOARD_NUMBERS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

const SEG = 360 / 20; // 18° per segment

/** Double-ring outer wire radius (mm) — our calibration reference. */
const D = 170;

const RADII = {
  innerBull: 6.35,
  outerBull: 15.9,
  tripleInner: 97, // outer edge of inner treble wire (107 − 10)
  tripleOuter: 107, // outer edge of outer treble wire
  doubleInner: 160, // outer edge of inner double wire (170 − 10)
  doubleOuter: D, // outer edge of outer double wire
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Polar (radius, degrees-from-12-o'clock-CW) → Cartesian. */
function polar(radius: number, angleDeg: number): Point {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

/** Sample `n` evenly-spaced points around a circle centred at the origin. */
function circlePoints(radius: number, n = 180): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    pts.push(polar(radius, (i / n) * 360));
  }
  return pts;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Segment-wire angles (degrees CW from 12 o'clock) used for calibration.
 * Each angle is the boundary between two adjacent segments.
 *
 *   Wire between 20 & 1  →   9°
 *   Wire between 6 & 10  →  99°
 *   Wire between 3 & 19  → 189°
 *   Wire between 11 & 14 → 279°
 */
const CAL_ANGLES = [9, 99, 189, 279] as const;

/**
 * The four "perfect board" positions that correspond to the calibration
 * clicks.  The user clicks the **double-ring outer corner** — where the
 * segment wire meets the double-ring outer wire — at 4 positions spaced
 * 90° apart:
 *
 *   P1  Double outer corner  20 / 1   →  polar(170,   9°)
 *   P2  Double outer corner   6 / 10  →  polar(170,  99°)
 *   P3  Double outer corner   3 / 19  →  polar(170, 189°)
 *   P4  Double outer corner  11 / 14  →  polar(170, 279°)
 */
export function getPerfectCalibrationPoints(): [Point, Point, Point, Point] {
  return CAL_ANGLES.map((a) => polar(D, a)) as [Point, Point, Point, Point];
}

export interface WireframeData {
  /** Ring outlines — each is a polyline of camera-space points. */
  rings: Point[][];
  /** Segment divider lines (start, end) in camera space. */
  segments: [Point, Point][];
}

/**
 * Generate the full dartboard wireframe, projected into camera space.
 *
 * @param M_inv  The **inverse** of the calibration matrix, i.e. the
 *               matrix that maps perfect-board → camera-space.
 *               (Calibration matrix M maps camera → perfect;
 *                pass `invertMatrix3x3(M)` here.)
 */
export function generateTransformedWireframe(M_inv: Matrix3x3): WireframeData {
  const ringRadii = [
    RADII.innerBull,
    RADII.outerBull,
    RADII.tripleInner,
    RADII.tripleOuter,
    RADII.doubleInner,
    RADII.doubleOuter,
  ];

  const rings = ringRadii.map((r) =>
    circlePoints(r).map((p) => transformPoint(M_inv, p)),
  );

  const segments: [Point, Point][] = [];
  for (let i = 0; i < 20; i++) {
    const angle = i * SEG - SEG / 2; // wire at segment boundary
    segments.push([
      transformPoint(M_inv, polar(RADII.outerBull, angle)),
      transformPoint(M_inv, polar(RADII.doubleOuter, angle)),
    ]);
  }

  return { rings, segments };
}
