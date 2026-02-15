/**
 * Convert a segment_id (+ optional board-mm coordinates from the backend)
 * into an (x, y) point in the DartBoard's 500×500 SVG viewBox.
 *
 * If board_x / board_y are provided (perfect-board mm from detection),
 * we map them directly.  Otherwise we place the marker at the centre
 * of the named segment.
 */

// ── Constants (must match DartBoard.tsx) ────────────────────────────────────

const BOARD_NUMBERS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

const SEG = 360 / 20; // 18° per segment
const CX = 250;
const CY = 250;
const BOARD_R = 247;

// Radii in SVG units (matching DartBoard.tsx)
const R = {
  innerBull: Math.round(BOARD_R * 0.028),
  outerBull: Math.round(BOARD_R * 0.071),
  innerSingleOuter: Math.round(BOARD_R * 0.439),
  tripleOuter: Math.round(BOARD_R * 0.474),
  outerSingleOuter: Math.round(BOARD_R * 0.719),
  doubleOuter: Math.round(BOARD_R * 0.754),
};

// Perfect-board outer-double radius in mm (for mm→SVG scaling)
const BOARD_MM_OUTER = 170;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Polar (radius in SVG units, degrees CW from 12-o'clock) → SVG coords. */
function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function numberToAngle(num: number): number {
  const idx = BOARD_NUMBERS.indexOf(num as (typeof BOARD_NUMBERS)[number]);
  return idx >= 0 ? idx * SEG : 0;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface HitPointResult {
  x: number;
  y: number;
}

/**
 * Get a DartBoard SVG viewBox point for a detection result.
 *
 * @param segmentId  e.g. "t-20", "d-5", "is-18", "os-18", "inner-bull", "outer-bull", "miss"
 * @param boardX     tip x in perfect-board mm (optional, from backend)
 * @param boardY     tip y in perfect-board mm (optional, from backend)
 */
export function segmentHitPoint(
  segmentId: string,
  boardX?: number | null,
  boardY?: number | null,
): HitPointResult {
  // ── Direct mapping from board-mm coordinates ─────────────────────────
  if (boardX != null && boardY != null) {
    // Scale: board mm → SVG units.
    // In board-mm, outer double = 170mm.  In SVG, outer double ≈ R.doubleOuter.
    const scale = R.doubleOuter / BOARD_MM_OUTER;
    return {
      x: CX + boardX * scale,
      y: CY + boardY * scale,
    };
  }

  // ── Fallback: place at centre of named segment ───────────────────────

  if (segmentId === "inner-bull") return { x: CX, y: CY };
  if (segmentId === "outer-bull") return polar(R.outerBull * 0.6, 45);
  if (segmentId === "miss") return polar(R.doubleOuter + 15, 30);

  // Parse "prefix-number" pattern
  const m = segmentId.match(/^(t|d|is|os)-(\d+)$/);
  if (!m) return { x: CX, y: CY }; // fallback

  const prefix = m[1];
  const num = parseInt(m[2], 10);
  const angle = numberToAngle(num);

  let radius: number;
  switch (prefix) {
    case "t":
      radius = (R.innerSingleOuter + R.tripleOuter) / 2;
      break;
    case "d":
      radius = (R.outerSingleOuter + R.doubleOuter) / 2;
      break;
    case "is":
      radius = (R.outerBull + R.innerSingleOuter) / 2;
      break;
    case "os":
      radius = (R.tripleOuter + R.outerSingleOuter) / 2;
      break;
    default:
      radius = R.innerSingleOuter / 2;
  }

  return polar(radius, angle);
}
