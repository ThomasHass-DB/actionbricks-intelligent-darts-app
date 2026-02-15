import { useState, useRef, useEffect, useCallback } from "react";
import { X, Undo2, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  type Point,
  type Matrix3x3,
  getPerspectiveTransform,
  invertMatrix3x3,
  validateTransform,
} from "@/lib/homography";
import {
  getPerfectCalibrationPoints,
  generateTransformedWireframe,
} from "@/lib/dartboard-geometry";
import { acquire, release } from "@/lib/kinesis-pool";

// ── Step instructions ───────────────────────────────────────────────────────

const STEPS = [
  "Click the outer corner where the 20/1 wire meets the double ring — top-right edge of the board",
  "Click the outer corner where the 6/10 wire meets the double ring — right-bottom edge of the board",
  "Click the outer corner where the 3/19 wire meets the double ring — bottom-left edge of the board",
  "Click the outer corner where the 11/14 wire meets the double ring — left-top edge of the board",
];

// ── Visual reference diagram ────────────────────────────────────────────────

function CalibrationGuide({ currentStep }: { currentStep: number }) {
  const S = 180;
  const C = S / 2;
  const doubleR = S * 0.42;
  const tripleR = doubleR * (107 / 170);
  const bullR = S * 0.04;

  // Helper: angle (degrees CW from 12 o'clock) → SVG x,y
  function svgPolar(r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
  }

  // 4 calibration target positions on the double outer ring
  const calAngles = [9, 99, 189, 279];
  const targets = calAngles.map((a, i) => ({
    ...svgPolar(doubleR, a),
    label: `P${i + 1}`,
  }));

  // Segment wire pairs for each calibration point
  const wireLabels = ["20/1", "6/10", "3/19", "11/14"];

  // Draw some segment wires extending from bull to double ring at cal angles
  const segLines = calAngles.map((a) => ({
    inner: svgPolar(bullR * 2, a),
    outer: svgPolar(doubleR, a),
  }));

  return (
    <svg
      width={S}
      height={S}
      viewBox={`0 0 ${S} ${S}`}
      className="block"
    >
      {/* Board rings */}
      <circle
        cx={C} cy={C} r={doubleR}
        fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2}
      />
      <circle
        cx={C} cy={C} r={tripleR}
        fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1}
        strokeDasharray="3 2"
      />
      <circle
        cx={C} cy={C} r={bullR}
        fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)"
        strokeWidth={0.5}
      />

      {/* Segment wires at calibration angles */}
      {segLines.map((sl, i) => (
        <line
          key={i}
          x1={sl.inner.x} y1={sl.inner.y}
          x2={sl.outer.x} y2={sl.outer.y}
          stroke="rgba(255,255,255,0.15)" strokeWidth={0.8}
        />
      ))}

      {/* Label: "double ring" with arrow */}
      <text
        x={C + doubleR * 0.35} y={C - doubleR - 4}
        fill="rgba(0,255,180,0.7)" fontSize={7}
        textAnchor="middle" fontWeight="bold"
      >
        double ring edge
      </text>

      {/* Wire pair labels near each target */}
      {targets.map((_, i) => {
        // Offset label outward from the ring
        const outward = svgPolar(doubleR + 16, calAngles[i]);
        return (
          <text
            key={`lbl-${i}`}
            x={outward.x} y={outward.y + 3}
            textAnchor="middle"
            fill="rgba(255,255,255,0.45)"
            fontSize={9}
            fontWeight="600"
          >
            {wireLabels[i]}
          </text>
        );
      })}

      {/* Calibration target dots */}
      {targets.map((t, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const future = i > currentStep;
        const fill = done
          ? "#00ffff"
          : active
            ? "#ffffff"
            : "rgba(255,255,255,0.25)";

        // Label positioned inward from the point
        const inward = svgPolar(doubleR - 14, calAngles[i]);

        return (
          <g key={i}>
            {/* Pulse ring for active target */}
            {active && (
              <circle cx={t.x} cy={t.y} r={6} fill="none" stroke="white" strokeWidth={1}>
                <animate attributeName="r" values="4;10;4" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
            <circle
              cx={t.x} cy={t.y}
              r={done ? 4 : active ? 5 : 3}
              fill={fill}
              opacity={future ? 0.4 : 1}
            />
            <text
              x={inward.x} y={inward.y + 3}
              textAnchor="middle"
              fill={fill}
              fontSize={9}
              fontWeight={active ? "bold" : "normal"}
              opacity={future ? 0.4 : 0.9}
            >
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────

interface CalibrationViewProps {
  /** Local device ID — used when mode is "local". */
  cameraDeviceId?: string;
  /** Pre-connected MediaStream — used when mode is "kinesis". */
  mediaStream?: MediaStream | null;
  /** Kinesis channel name — CalibrationView establishes its own connection. */
  kinesisChannelName?: string;
  /** AWS region for Kinesis. */
  kinesisRegion?: string;
  onComplete: (points: Point[], matrix: Matrix3x3) => void;
  onCancel: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function CalibrationView({
  cameraDeviceId,
  mediaStream,
  kinesisChannelName,
  kinesisRegion,
  onComplete,
  onCancel,
}: CalibrationViewProps) {
  // DOM refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);

  // Render-loop data (mutated per-frame, no re-renders)
  const pointsRef = useRef<Point[]>([]);
  const mousePosRef = useRef<Point | null>(null);
  /** M maps camera → perfect board (the calibration result). */
  const matrixRef = useRef<Matrix3x3 | null>(null);
  /** M_inv maps perfect board → camera (used for wireframe overlay). */
  const matrixInvRef = useRef<Matrix3x3 | null>(null);

  // React state (UI indicators only)
  const [pointCount, setPointCount] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Camera stream ───────────────────────────────────────────────────────
  // Track whether we own the stream so we can clean up properly.
  const ownsStreamRef = useRef(false);
  const kinesisChannelRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let localStream: MediaStream | null = null;

    (async () => {
      try {
        let streamToUse: MediaStream;

        if (kinesisChannelName) {
          // Kinesis mode — acquire from the shared pool (reuses existing session)
          kinesisChannelRef.current = kinesisChannelName;
          streamToUse = await acquire(kinesisChannelName);
          if (cancelled) {
            release(kinesisChannelName);
            return;
          }
          ownsStreamRef.current = false; // Pool owns the session
        } else if (mediaStream) {
          // Pre-connected stream (we don't own it)
          streamToUse = mediaStream;
          ownsStreamRef.current = false;
        } else {
          // Local mode — acquire via getUserMedia
          localStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: cameraDeviceId ? { exact: cameraDeviceId } : undefined,
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });

          if (cancelled) {
            localStream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamToUse = localStream;
          ownsStreamRef.current = true;
        }

        const video = videoRef.current!;
        video.srcObject = streamToUse;
        await new Promise<void>((r) => {
          video.onloadedmetadata = () => r();
        });
        await video.play();

        if (!cancelled) setVideoReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to access camera",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      // Release Kinesis pool reference
      if (kinesisChannelRef.current) {
        release(kinesisChannelRef.current);
        kinesisChannelRef.current = null;
      }
      // Only stop local tracks if we own the stream
      if (ownsStreamRef.current && localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraDeviceId, mediaStream, kinesisChannelName, kinesisRegion]);

  // ── Coordinate conversion (CSS px → video px) ──────────────────────────

  const toVideoCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * c.width,
        y: ((e.clientY - r.top) / r.height) * c.height,
      };
    },
    [],
  );

  // ── Click / mouse handlers ─────────────────────────────────────────────

  // We track a separate state for "has matrix" to drive React UI
  const [hasMatrix, setHasMatrix] = useState(false);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (pointsRef.current.length >= 4) return;
      const p = toVideoCoords(e);
      pointsRef.current = [...pointsRef.current, p];
      setPointCount(pointsRef.current.length);

      if (pointsRef.current.length === 4) {
        try {
          const targetPoints = getPerfectCalibrationPoints();
          const userPoints = pointsRef.current as [Point, Point, Point, Point];

          // M maps camera → perfect board  (for dart detection)
          const M = getPerspectiveTransform(userPoints, targetPoints);

          // Validate: userPoints through M should land on targetPoints
          const maxErr = validateTransform(M, userPoints, targetPoints);
          if (maxErr > 5) {
            console.warn(
              `Homography reprojection error: ${maxErr.toFixed(1)}px`,
            );
          }

          // M_inv maps perfect board → camera  (for wireframe overlay)
          const M_inv = invertMatrix3x3(M);

          matrixRef.current = M;
          matrixInvRef.current = M_inv;
          setHasMatrix(true);
        } catch (err) {
          console.error("Homography failed:", err);
          toast.error("Calibration failed — try picking more distinct points.");
          // Undo the 4th point so the user can retry
          pointsRef.current = pointsRef.current.slice(0, -1);
          setPointCount(pointsRef.current.length);
        }
      }
    },
    [toVideoCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      mousePosRef.current = toVideoCoords(e);
    },
    [toVideoCoords],
  );

  const handleMouseLeave = useCallback(() => {
    mousePosRef.current = null;
  }, []);

  const handleUndo = useCallback(() => {
    pointsRef.current = pointsRef.current.slice(0, -1);
    matrixRef.current = null;
    matrixInvRef.current = null;
    setHasMatrix(false);
    setPointCount(pointsRef.current.length);
  }, []);

  const handleReset = useCallback(() => {
    pointsRef.current = [];
    matrixRef.current = null;
    matrixInvRef.current = null;
    setHasMatrix(false);
    setPointCount(0);
  }, []);

  const handleAccept = useCallback(() => {
    if (matrixRef.current && pointsRef.current.length === 4) {
      toast.success("Calibration saved successfully!");
      onComplete(pointsRef.current, matrixRef.current);
    }
  }, [onComplete]);

  // Derive isComplete from both pointCount AND hasMatrix
  const calibrationDone = pointCount >= 4 && hasMatrix;

  // ── Render loop ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!videoReady) return;

    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const zoomCvs = zoomCanvasRef.current!;
    const zoomCtx = zoomCvs.getContext("2d")!;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;

    // Fit canvas inside its container while preserving aspect ratio
    function resize() {
      const container = containerRef.current;
      if (!container) return;
      const { width: cw, height: ch } = container.getBoundingClientRect();
      const vr = vw / vh;
      const cr = cw / ch;
      if (vr > cr) {
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${Math.round(cw / vr)}px`;
      } else {
        canvas.style.height = `${ch}px`;
        canvas.style.width = `${Math.round(ch * vr)}px`;
      }
    }
    resize();
    window.addEventListener("resize", resize);

    // Zoom config – 4× magnification for precise clicking
    const ZOOM_DISPLAY = 200;
    const ZOOM_SRC = 25; // source-px radius → 50×50 → 200×200 = 4×
    zoomCvs.width = ZOOM_DISPLAY;
    zoomCvs.height = ZOOM_DISPLAY;

    function draw() {
      const pts = pointsRef.current;
      const mp = mousePosRef.current;
      const M_inv = matrixInvRef.current;

      // ── Main canvas ───────────────────────────────────────────────────
      ctx.drawImage(video, 0, 0);

      // Picked points
      for (let i = 0; i < pts.length; i++) {
        const { x, y } = pts[i];
        // Glow
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,255,255,0.12)";
        ctx.fill();
        // Ring
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = "#00ffff";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Centre dot
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#00ffff";
        ctx.fill();
        // Label
        ctx.font = "bold 14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#00ffff";
        ctx.fillText(`P${i + 1}`, x, y - 24);
      }

      // Wireframe overlay — use M_inv (perfect → camera) to warp
      // the ideal board lines onto the camera feed.
      if (M_inv) {
        try {
          const wf = generateTransformedWireframe(M_inv);

          // Rings – cyan, thick enough to see clearly
          ctx.strokeStyle = "rgba(0, 255, 255, 0.75)";
          ctx.lineWidth = 2.5;
          for (const ring of wf.rings) {
            ctx.beginPath();
            ring.forEach((p, j) =>
              j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
            );
            ctx.closePath();
            ctx.stroke();
          }

          // Segments – yellow
          ctx.strokeStyle = "rgba(255, 255, 0, 0.55)";
          ctx.lineWidth = 1.5;
          for (const [a, b] of wf.segments) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        } catch {
          // If wireframe generation fails, skip it silently
        }
      }

      // Crosshair at cursor (only while picking)
      if (mp && pts.length < 4) {
        ctx.save();
        ctx.strokeStyle = "rgba(59,130,246,0.8)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(mp.x - 40, mp.y);
        ctx.lineTo(mp.x + 40, mp.y);
        ctx.moveTo(mp.x, mp.y - 40);
        ctx.lineTo(mp.x, mp.y + 40);
        ctx.stroke();
        ctx.restore();
      }

      // ── Zoom canvas (only while picking) ──────────────────────────────
      zoomCtx.clearRect(0, 0, ZOOM_DISPLAY, ZOOM_DISPLAY);

      if (mp && pts.length < 4) {
        const sx = Math.max(0, Math.min(vw - ZOOM_SRC * 2, mp.x - ZOOM_SRC));
        const sy = Math.max(0, Math.min(vh - ZOOM_SRC * 2, mp.y - ZOOM_SRC));

        zoomCtx.drawImage(
          video,
          sx,
          sy,
          ZOOM_SRC * 2,
          ZOOM_SRC * 2,
          0,
          0,
          ZOOM_DISPLAY,
          ZOOM_DISPLAY,
        );

        // Picked points in zoom space
        for (let i = 0; i < pts.length; i++) {
          const zx =
            ((pts[i].x - sx) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
          const zy =
            ((pts[i].y - sy) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
          if (
            zx > -20 &&
            zx < ZOOM_DISPLAY + 20 &&
            zy > -20 &&
            zy < ZOOM_DISPLAY + 20
          ) {
            zoomCtx.beginPath();
            zoomCtx.arc(zx, zy, 10, 0, Math.PI * 2);
            zoomCtx.strokeStyle = "#00ffff";
            zoomCtx.lineWidth = 2;
            zoomCtx.stroke();
            zoomCtx.font = "bold 11px system-ui";
            zoomCtx.textAlign = "center";
            zoomCtx.fillStyle = "#00ffff";
            zoomCtx.fillText(`P${i + 1}`, zx, zy - 15);
          }
        }

        // Cursor crosshair in zoom
        const cZx = ((mp.x - sx) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
        const cZy = ((mp.y - sy) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;

        zoomCtx.strokeStyle = "rgba(59,130,246,0.9)";
        zoomCtx.lineWidth = 1.5;
        zoomCtx.beginPath();
        zoomCtx.moveTo(cZx - 14, cZy);
        zoomCtx.lineTo(cZx - 4, cZy);
        zoomCtx.moveTo(cZx + 4, cZy);
        zoomCtx.lineTo(cZx + 14, cZy);
        zoomCtx.moveTo(cZx, cZy - 14);
        zoomCtx.lineTo(cZx, cZy - 4);
        zoomCtx.moveTo(cZx, cZy + 4);
        zoomCtx.lineTo(cZx, cZy + 14);
        zoomCtx.stroke();

        // Border
        zoomCtx.strokeStyle = "rgba(255,255,255,0.2)";
        zoomCtx.lineWidth = 1;
        zoomCtx.strokeRect(0, 0, ZOOM_DISPLAY, ZOOM_DISPLAY);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [videoReady]);

  // ── Error state ────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm px-6">
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={onCancel}
            className="h-9 px-4 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col select-none">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 py-3.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  i < pointCount
                    ? "bg-cyan-400"
                    : i === pointCount && !calibrationDone
                      ? "bg-white ring-2 ring-white/30 scale-110"
                      : calibrationDone
                        ? "bg-cyan-400"
                        : "bg-white/20"
                }`}
              />
            ))}
          </div>
          <span className="text-sm text-white/80 font-medium">
            {calibrationDone
              ? "Calibration complete — review the wireframe overlay"
              : STEPS[Math.min(pointCount, 3)]}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors pointer-events-auto"
          title="Cancel calibration"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── Video + Canvas ───────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden py-14 px-4"
      >
        <video ref={videoRef} className="hidden" playsInline muted />
        <canvas
          ref={canvasRef}
          className={`rounded-lg ${calibrationDone ? "cursor-default" : "cursor-crosshair"}`}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Loading spinner */}
        {!videoReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              Starting camera…
            </div>
          </div>
        )}
      </div>

      {/* ── Right-side panel (guide + zoom) ──────────────────────────── */}
      <div
        className={`absolute top-14 right-4 z-20 flex flex-col gap-2 transition-opacity duration-300 ${
          calibrationDone ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        {/* Reference guide */}
        <div className="rounded-lg overflow-hidden shadow-2xl border border-white/15 bg-black/90">
          <div className="text-[10px] text-white/50 bg-black/80 px-2 py-0.5 text-center tracking-wider font-medium uppercase">
            Reference
          </div>
          <div className="p-1">
            <CalibrationGuide currentStep={pointCount} />
          </div>
        </div>

        {/* Zoom window */}
        <div className="rounded-lg overflow-hidden shadow-2xl border border-white/15 bg-black">
          <div className="text-[10px] text-white/50 bg-black/80 px-2 py-0.5 text-center tracking-wider font-medium uppercase">
            4× Zoom
          </div>
          <canvas
            ref={zoomCanvasRef}
            style={{ width: 140, height: 140, display: "block" }}
          />
        </div>
      </div>

      {/* ── Bottom bar ───────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
        {pointCount > 0 && !calibrationDone && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm text-white/80 bg-white/10 hover:bg-white/15 backdrop-blur-sm transition-colors pointer-events-auto"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </button>
        )}

        {calibrationDone && (
          <>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm text-white/80 bg-white/10 hover:bg-white/15 backdrop-blur-sm transition-colors pointer-events-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Redo
            </button>
            <button
              onClick={handleAccept}
              className="flex items-center gap-1.5 h-9 px-5 rounded-lg text-sm font-medium bg-cyan-500 text-black hover:bg-cyan-400 transition-colors pointer-events-auto"
            >
              <Check className="w-3.5 h-3.5" />
              Accept Calibration
            </button>
          </>
        )}
      </div>
    </div>
  );
}
