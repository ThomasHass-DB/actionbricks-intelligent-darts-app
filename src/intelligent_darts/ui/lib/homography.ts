/**
 * Perspective-transform math engine.
 * Implements the same algorithm as OpenCV's cv2.getPerspectiveTransform.
 */

export type Point = { x: number; y: number };

export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

// ── Linear algebra ──────────────────────────────────────────────────────────

/**
 * Gaussian elimination with partial pivoting.
 * Solves the NxN system  Ax = b  and returns x.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting — find the row with the largest absolute value
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-14) {
      throw new Error(
        "Singular matrix — calibration points may be degenerate.",
      );
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j];
    }
  }

  // Back-substitution
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) sum -= aug[i][j] * x[j];
    x[i] = sum / aug[i][i];
  }
  return x;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the 3x3 perspective-transformation matrix that maps
 * `src[i]` → `dst[i]`  for i = 0 … 3.
 *
 * Equivalent to `cv2.getPerspectiveTransform(src, dst)`.
 */
export function getPerspectiveTransform(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): Matrix3x3 {
  // Build 8×8 system   (h has 8 unknowns, h33 is normalised to 1)
  //   u = (h0*x + h1*y + h2) / (h6*x + h7*y + 1)
  //   v = (h3*x + h4*y + h5) / (h6*x + h7*y + 1)
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);

  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

/**
 * Apply the 3×3 perspective transform **M** to a single point.
 */
export function transformPoint(M: Matrix3x3, p: Point): Point {
  const w = M[2][0] * p.x + M[2][1] * p.y + M[2][2];
  return {
    x: (M[0][0] * p.x + M[0][1] * p.y + M[0][2]) / w,
    y: (M[1][0] * p.x + M[1][1] * p.y + M[1][2]) / w,
  };
}

/**
 * Invert a 3×3 matrix using the adjugate / cofactor method.
 * Throws if the matrix is singular.
 */
export function invertMatrix3x3(M: Matrix3x3): Matrix3x3 {
  const [[a, b, c], [d, e, f], [g, h, k]] = M;

  const det =
    a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);

  if (Math.abs(det) < 1e-14) {
    throw new Error("Matrix is singular — cannot invert.");
  }

  const invDet = 1 / det;

  return [
    [
      (e * k - f * h) * invDet,
      (c * h - b * k) * invDet,
      (b * f - c * e) * invDet,
    ],
    [
      (f * g - d * k) * invDet,
      (a * k - c * g) * invDet,
      (c * d - a * f) * invDet,
    ],
    [
      (d * h - e * g) * invDet,
      (b * g - a * h) * invDet,
      (a * e - b * d) * invDet,
    ],
  ];
}

/**
 * Validate a perspective transform by checking that the source
 * calibration points map to within `maxErrorPx` of the destination
 * points. Returns the max reprojection error in pixels.
 */
export function validateTransform(
  M: Matrix3x3,
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): number {
  let maxErr = 0;
  for (let i = 0; i < 4; i++) {
    const mapped = transformPoint(M, src[i]);
    const dx = mapped.x - dst[i].x;
    const dy = mapped.y - dst[i].y;
    const err = Math.sqrt(dx * dx + dy * dy);
    if (err > maxErr) maxErr = err;
  }
  return maxErr;
}
