import { useState, useMemo, useRef, useCallback } from "react";

// Standard dartboard number order (clockwise from top)
const BOARD_NUMBERS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

const SEG = 360 / 20; // 18 degrees per segment
const CX = 250;
const CY = 250;

// Radii calibrated to match the Winmau Blade 6 photo (standard dartboard proportions)
// The image fills the full 500x500 viewBox, board radius ~ 247
const BOARD_R = 247;
const R = {
  innerBull: Math.round(BOARD_R * 0.028), // ~7
  outerBull: Math.round(BOARD_R * 0.071), // ~18
  innerSingleOuter: Math.round(BOARD_R * 0.439), // ~108
  tripleOuter: Math.round(BOARD_R * 0.474), // ~117
  outerSingleOuter: Math.round(BOARD_R * 0.719), // ~178
  doubleOuter: Math.round(BOARD_R * 0.754), // ~186
};

// --- Geometry helpers ---

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

function wedgePath(r1: number, r2: number, a1: number, a2: number): string {
  const [ix1, iy1] = polar(r1, a1);
  const [ix2, iy2] = polar(r1, a2);
  const [ox1, oy1] = polar(r2, a1);
  const [ox2, oy2] = polar(r2, a2);
  const lg = a2 - a1 > 180 ? 1 : 0;
  return [
    `M${ix1},${iy1}`,
    `A${r1},${r1} 0 ${lg} 1 ${ix2},${iy2}`,
    `L${ox2},${oy2}`,
    `A${r2},${r2} 0 ${lg} 0 ${ox1},${oy1}`,
    "Z",
  ].join(" ");
}

// --- Segment data ---

interface Segment {
  id: string;
  path: string;
  value: number;
  label: string;
}

function buildSegments(): Segment[] {
  const segs: Segment[] = [];

  for (let i = 0; i < 20; i++) {
    const num = BOARD_NUMBERS[i];
    const a1 = i * SEG - SEG / 2;
    const a2 = i * SEG + SEG / 2;

    // Double ring
    segs.push({
      id: `d-${num}`,
      path: wedgePath(R.outerSingleOuter, R.doubleOuter, a1, a2),
      value: num * 2,
      label: `D${num}`,
    });

    // Outer single
    segs.push({
      id: `os-${num}`,
      path: wedgePath(R.tripleOuter, R.outerSingleOuter, a1, a2),
      value: num,
      label: `${num}`,
    });

    // Triple ring
    segs.push({
      id: `t-${num}`,
      path: wedgePath(R.innerSingleOuter, R.tripleOuter, a1, a2),
      value: num * 3,
      label: `T${num}`,
    });

    // Inner single
    segs.push({
      id: `is-${num}`,
      path: wedgePath(R.outerBull, R.innerSingleOuter, a1, a2),
      value: num,
      label: `${num}`,
    });
  }

  return segs;
}

// --- Hit visualization ---

export interface DartBoardHit {
  x: number; // SVG viewBox coordinate (0-500)
  y: number; // SVG viewBox coordinate (0-500)
  segmentId: string;
  value: number;
  label: string;
}

/** Get the accent color for a hit based on its label/type */
function getHitColor(label: string): string {
  if (label === "MISS") return "#ef4444"; // red for miss
  if (label === "D-BULL" || label === "BULL") return "#facc15"; // gold
  if (label.startsWith("T")) return "#a855f7"; // purple
  if (label.startsWith("D")) return "#06b6d4"; // cyan
  return "#94a3b8"; // slate for singles
}

// --- Component ---

interface DartBoardProps {
  onScore: (
    value: number,
    label: string,
    hit: { x: number; y: number; segmentId: string },
  ) => void;
  disabled?: boolean;
  hits?: DartBoardHit[];
}

export function DartBoard({
  onScore,
  disabled = false,
  hits = [],
}: DartBoardProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const segments = useMemo(buildSegments, []);
  const svgRef = useRef<SVGSVGElement>(null);

  const cursor = disabled ? "default" : "pointer";

  /** Convert a mouse event's screen position to SVG viewBox coordinates */
  const getSvgCoords = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: CX, y: CY };
      const rect = svg.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 500,
        y: ((e.clientY - rect.top) / rect.height) * 500,
      };
    },
    [],
  );

  /** Map segmentId -> SVG path data for hit highlighting */
  const segmentPaths = useMemo(() => {
    const map = new Map<string, string>();
    for (const seg of segments) {
      map.set(seg.id, seg.path);
    }
    return map;
  }, [segments]);

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: 500 }}>
      {/* AI glow effect behind the board */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="absolute rounded-full animate-[glow-spin_8s_linear_infinite]"
          style={{
            width: "115%",
            height: "115%",
            background:
              "conic-gradient(from 0deg, rgba(99,102,241,0.55), rgba(139,92,246,0.45), rgba(6,182,212,0.55), rgba(59,130,246,0.45), rgba(168,85,247,0.5), rgba(99,102,241,0.55))",
            filter: "blur(45px)",
          }}
        />
        <div
          className="absolute rounded-full animate-[glow-pulse_4s_ease-in-out_infinite]"
          style={{
            width: "95%",
            height: "95%",
            background:
              "radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(6,182,212,0.25) 40%, transparent 70%)",
            filter: "blur(25px)",
          }}
        />
        <div
          className="absolute rounded-full animate-[glow-spin_12s_linear_infinite_reverse]"
          style={{
            width: "108%",
            height: "108%",
            background:
              "conic-gradient(from 180deg, rgba(6,182,212,0.45), transparent 25%, rgba(168,85,247,0.45), transparent 50%, rgba(59,130,246,0.45), transparent 75%)",
            filter: "blur(35px)",
          }}
        />
      </div>

      {/* Dartboard image */}
      <div className="relative rounded-full overflow-hidden shadow-2xl border-0">
        <img
          src="/dartboard.png"
          alt="Dartboard"
          className="w-full h-full object-cover scale-[1.03]"
          draggable={false}
        />

        {/* SVG overlay for interactions + hit effects */}
        <svg
          ref={svgRef}
          viewBox="0 0 500 500"
          className="absolute inset-0 w-full h-full"
        >
          {/* SVG filters for glow effects */}
          <defs>
            <filter
              id="dart-glow"
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter
              id="score-glow"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="3"
                floodColor="white"
                floodOpacity="0.7"
              />
            </filter>
          </defs>

          {/* ── Layer 1: Hit segment highlights ── */}
          {hits.map((hit, i) => {
            const isLatest = i === hits.length - 1;
            const color = getHitColor(hit.label);
            const baseOpacity = isLatest ? 0.45 : 0.12;

            // Miss ring (outside doubles)
            if (hit.segmentId === "miss") {
              return (
                <circle
                  key={`seg-${i}`}
                  cx={CX}
                  cy={CY}
                  r={(BOARD_R + R.doubleOuter) / 2}
                  fill="none"
                  stroke={color}
                  strokeWidth={BOARD_R - R.doubleOuter}
                  opacity={baseOpacity}
                  className={
                    isLatest
                      ? "animate-[hit-segment-flash_1.2s_ease-out_forwards]"
                      : ""
                  }
                  style={{ pointerEvents: "none" }}
                />
              );
            }

            // Bull regions
            if (
              hit.segmentId === "inner-bull" ||
              hit.segmentId === "outer-bull"
            ) {
              const r =
                hit.segmentId === "inner-bull" ? R.innerBull : R.outerBull;
              return (
                <circle
                  key={`seg-${i}`}
                  cx={CX}
                  cy={CY}
                  r={r}
                  fill={color}
                  opacity={baseOpacity}
                  className={
                    isLatest
                      ? "animate-[hit-segment-flash_1.2s_ease-out_forwards]"
                      : ""
                  }
                  style={{ pointerEvents: "none" }}
                />
              );
            }

            // Regular segments
            const path = segmentPaths.get(hit.segmentId);
            if (!path) return null;
            return (
              <path
                key={`seg-${i}`}
                d={path}
                fill={color}
                opacity={baseOpacity}
                className={
                  isLatest
                    ? "animate-[hit-segment-flash_1.2s_ease-out_forwards]"
                    : ""
                }
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {/* ── Layer 2: Interactive hit regions (invisible) ── */}

          {/* Outer miss ring (outside double ring, inside board edge) */}
          <circle
            cx={CX}
            cy={CY}
            r={BOARD_R}
            fill={
              hovered === "miss" ? "rgba(239,68,68,0.1)" : "transparent"
            }
            style={{ cursor, transition: "fill 0.1s" }}
            onClick={(e) => {
              if (disabled) return;
              const coords = getSvgCoords(e);
              onScore(0, "MISS", { ...coords, segmentId: "miss" });
            }}
            onMouseEnter={() => !disabled && setHovered("miss")}
            onMouseLeave={() => setHovered(null)}
          />

          {segments.map((seg) => (
            <path
              key={seg.id}
              d={seg.path}
              fill={
                hovered === seg.id ? "rgba(255,255,255,0.15)" : "transparent"
              }
              style={{ cursor, transition: "fill 0.1s" }}
              onClick={(e) => {
                if (disabled) return;
                const coords = getSvgCoords(e);
                onScore(seg.value, seg.label, {
                  ...coords,
                  segmentId: seg.id,
                });
              }}
              onMouseEnter={() => !disabled && setHovered(seg.id)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}

          {/* Outer bull hit region */}
          <circle
            cx={CX}
            cy={CY}
            r={R.outerBull}
            fill={
              hovered === "outer-bull"
                ? "rgba(255,255,255,0.15)"
                : "transparent"
            }
            style={{ cursor, transition: "fill 0.1s" }}
            onClick={(e) => {
              if (disabled) return;
              const coords = getSvgCoords(e);
              onScore(25, "BULL", { ...coords, segmentId: "outer-bull" });
            }}
            onMouseEnter={() => !disabled && setHovered("outer-bull")}
            onMouseLeave={() => setHovered(null)}
          />

          {/* Inner bull hit region */}
          <circle
            cx={CX}
            cy={CY}
            r={R.innerBull}
            fill={
              hovered === "inner-bull"
                ? "rgba(255,255,255,0.2)"
                : "transparent"
            }
            style={{ cursor, transition: "fill 0.1s" }}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              const coords = getSvgCoords(e);
              onScore(50, "D-BULL", { ...coords, segmentId: "inner-bull" });
            }}
            onMouseEnter={() => !disabled && setHovered("inner-bull")}
            onMouseLeave={() => setHovered(null)}
          />

          {/* ── Layer 3: Impact points and effects ── */}
          {hits.map((hit, i) => {
            const isLatest = i === hits.length - 1;
            const color = getHitColor(hit.label);
            return (
              <g key={`point-${i}`} style={{ pointerEvents: "none" }}>
                {/* Expanding ripple rings (latest hit only) */}
                {isLatest && (
                  <>
                    <circle
                      cx={hit.x}
                      cy={hit.y}
                      r={6}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      opacity={0}
                      style={{
                        transformOrigin: `${hit.x}px ${hit.y}px`,
                      }}
                      className="animate-[hit-ripple_0.8s_ease-out_forwards]"
                    />
                    <circle
                      cx={hit.x}
                      cy={hit.y}
                      r={6}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      opacity={0}
                      style={{
                        transformOrigin: `${hit.x}px ${hit.y}px`,
                      }}
                      className="animate-[hit-ripple_0.8s_ease-out_0.12s_forwards]"
                    />
                  </>
                )}

                {/* Soft glow halo */}
                <circle
                  cx={hit.x}
                  cy={hit.y}
                  r={isLatest ? 10 : 6}
                  fill={color}
                  opacity={isLatest ? 0.35 : 0.15}
                  filter="url(#dart-glow)"
                />

                {/* Dart tip marker */}
                <circle
                  cx={hit.x}
                  cy={hit.y}
                  r={isLatest ? 4.5 : 3}
                  fill={color}
                  stroke="white"
                  strokeWidth={isLatest ? 1.5 : 1}
                  style={
                    isLatest
                      ? { transformOrigin: `${hit.x}px ${hit.y}px` }
                      : undefined
                  }
                  className={
                    isLatest
                      ? "animate-[hit-point-pop_0.35s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
                      : ""
                  }
                />

                {/* Floating score label (latest hit only) */}
                {isLatest && (
                  <text
                    x={hit.x}
                    y={hit.y - 16}
                    textAnchor="middle"
                    dominantBaseline="auto"
                    fill="white"
                    stroke={color}
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontSize={14}
                    fontWeight="bold"
                    filter="url(#score-glow)"
                    style={{
                      transformOrigin: `${hit.x}px ${hit.y - 16}px`,
                    }}
                    className="animate-[score-float-up_1.8s_ease-out_forwards]"
                  >
                    {hit.value}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
