import { useState, useRef, useCallback, useEffect } from "react";
import { Undo2, Trash2, EyeOff } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface DartAnnotation {
  tip: Point;
  /** null when tail is out of frame */
  tail: Point | null;
}

interface LabelCanvasProps {
  imageUrl: string;
  initialDarts?: DartAnnotation[];
  onDartsChange?: (darts: DartAnnotation[]) => void;
}

// ── Zoom config ─────────────────────────────────────────────────────────────

const ZOOM_DISPLAY = 200; // px on screen
const ZOOM_SRC = 30; // source-px radius → ~3.3× magnification

// ── Component ───────────────────────────────────────────────────────────────

export function LabelCanvas({
  imageUrl,
  initialDarts = [],
  onDartsChange,
}: LabelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Completed darts (tip + optional tail)
  const [darts, setDarts] = useState<DartAnnotation[]>(initialDarts);
  // Pending tip (waiting for tail click or "no tail")
  const [pendingTip, setPendingTip] = useState<Point | null>(null);
  // Track image loaded state
  const [imageLoaded, setImageLoaded] = useState(false);
  // Display dimensions
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  // Mouse position in image coordinates (for zoom)
  const [mousePos, setMousePos] = useState<Point | null>(null);

  // Load image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  // Resize canvas to fit container while preserving aspect ratio
  useEffect(() => {
    if (!imageLoaded || !imgRef.current || !containerRef.current) return;
    const img = imgRef.current;
    const container = containerRef.current;

    function resize() {
      const { width: cw, height: ch } = container!.getBoundingClientRect();
      const ar = img.naturalWidth / img.naturalHeight;
      let w: number, h: number;
      if (ar > cw / ch) {
        w = cw;
        h = cw / ar;
      } else {
        h = ch;
        w = ch * ar;
      }
      setDisplaySize({ w, h });
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [imageLoaded]);

  // Redraw main canvas whenever state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageLoaded) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Draw completed darts
    for (let i = 0; i < darts.length; i++) {
      const dart = darts[i];
      if (dart.tail) {
        drawDartVector(ctx, dart.tip, dart.tail, i + 1);
      } else {
        drawTipOnly(ctx, dart.tip, i + 1);
      }
    }

    // Draw pending tip
    if (pendingTip) {
      drawPoint(ctx, pendingTip, "red", "T", 10);
      // Pulsing ring
      ctx.beginPath();
      ctx.arc(pendingTip.x, pendingTip.y, 18, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,100,100,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Crosshair at cursor
    if (mousePos) {
      ctx.save();
      ctx.strokeStyle = "rgba(59,130,246,0.8)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(mousePos.x - 30, mousePos.y);
      ctx.lineTo(mousePos.x + 30, mousePos.y);
      ctx.moveTo(mousePos.x, mousePos.y - 30);
      ctx.lineTo(mousePos.x, mousePos.y + 30);
      ctx.stroke();
      ctx.restore();
    }
  }, [darts, pendingTip, imageLoaded, displaySize, mousePos]);

  // Draw zoom canvas
  useEffect(() => {
    const zoomCvs = zoomCanvasRef.current;
    const img = imgRef.current;
    if (!zoomCvs || !img || !imageLoaded) return;

    zoomCvs.width = ZOOM_DISPLAY;
    zoomCvs.height = ZOOM_DISPLAY;
    const zoomCtx = zoomCvs.getContext("2d")!;
    zoomCtx.clearRect(0, 0, ZOOM_DISPLAY, ZOOM_DISPLAY);

    if (!mousePos) return;

    const vw = img.naturalWidth;
    const vh = img.naturalHeight;
    const sx = Math.max(0, Math.min(vw - ZOOM_SRC * 2, mousePos.x - ZOOM_SRC));
    const sy = Math.max(0, Math.min(vh - ZOOM_SRC * 2, mousePos.y - ZOOM_SRC));

    // Draw magnified region from the image
    zoomCtx.drawImage(
      img,
      sx,
      sy,
      ZOOM_SRC * 2,
      ZOOM_SRC * 2,
      0,
      0,
      ZOOM_DISPLAY,
      ZOOM_DISPLAY,
    );

    // Draw existing annotations in zoom space
    for (let i = 0; i < darts.length; i++) {
      const dart = darts[i];
      drawZoomPoint(zoomCtx, dart.tip, sx, sy, "#ef4444", `T${i + 1}`);
      if (dart.tail) {
        drawZoomPoint(zoomCtx, dart.tail, sx, sy, "#3b82f6", `F${i + 1}`);
      }
    }

    // Pending tip in zoom
    if (pendingTip) {
      drawZoomPoint(zoomCtx, pendingTip, sx, sy, "#ef4444", "T");
    }

    // Cursor crosshair in zoom
    const cZx = ((mousePos.x - sx) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
    const cZy = ((mousePos.y - sy) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
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
  }, [mousePos, darts, pendingTip, imageLoaded]);

  // Convert click/mouse position to image coordinates
  const toImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    },
    [],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pt = toImageCoords(e);

      if (!pendingTip) {
        // First click = Tip
        setPendingTip(pt);
      } else {
        // Second click = Tail -> complete dart
        const newDarts = [...darts, { tip: pendingTip, tail: pt }];
        setDarts(newDarts);
        setPendingTip(null);
        onDartsChange?.(newDarts);
      }
    },
    [pendingTip, darts, toImageCoords, onDartsChange],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setMousePos(toImageCoords(e));
    },
    [toImageCoords],
  );

  const handleMouseLeave = useCallback(() => {
    setMousePos(null);
  }, []);

  const handleNoTail = useCallback(() => {
    if (!pendingTip) return;
    const newDarts = [...darts, { tip: pendingTip, tail: null }];
    setDarts(newDarts);
    setPendingTip(null);
    onDartsChange?.(newDarts);
  }, [pendingTip, darts, onDartsChange]);

  const handleUndo = useCallback(() => {
    if (pendingTip) {
      // Undo pending tip
      setPendingTip(null);
    } else if (darts.length > 0) {
      // Undo last completed dart
      const newDarts = darts.slice(0, -1);
      setDarts(newDarts);
      onDartsChange?.(newDarts);
    }
  }, [pendingTip, darts, onDartsChange]);

  const handleClear = useCallback(() => {
    setDarts([]);
    setPendingTip(null);
    onDartsChange?.([]);
  }, [onDartsChange]);

  const canUndo = pendingTip !== null || darts.length > 0;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Instructions + actions */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {pendingTip
            ? "Click the dart TAIL (flight end) — or press \"No Tail\" if out of frame"
            : `Click the dart TIP (point) — red dot${darts.length > 0 ? ` • ${darts.length} dart${darts.length > 1 ? "s" : ""} marked` : ""}`}
        </div>
        <div className="flex items-center gap-1">
          {pendingTip && (
            <button
              onClick={handleNoTail}
              className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
              title="Mark dart with tip only (tail out of frame)"
            >
              <EyeOff className="w-3 h-3" />
              No Tail
            </button>
          )}
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
          <button
            onClick={handleClear}
            disabled={darts.length === 0 && !pendingTip}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Canvas + Zoom panel */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Main canvas */}
        <div
          ref={containerRef}
          className="flex-1 flex items-center justify-center overflow-hidden rounded-lg bg-black"
        >
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="cursor-crosshair"
            style={{
              width: displaySize.w || "100%",
              height: displaySize.h || "100%",
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
        </div>

        {/* Zoom panel (right side) */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <div className="rounded-lg overflow-hidden border border-border bg-black">
            <div className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 text-center tracking-wider font-medium uppercase">
              Zoom
            </div>
            <canvas
              ref={zoomCanvasRef}
              style={{ width: 160, height: 160, display: "block" }}
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span>T = Tip (point)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span>F = Tail (flight)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-yellow-400 rounded" />
          <span>Dart vector</span>
        </div>
        <div className="flex items-center gap-1.5">
          <EyeOff className="w-3 h-3 text-amber-400" />
          <span>Tail out of frame</span>
        </div>
      </div>
    </div>
  );
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

function drawPoint(
  ctx: CanvasRenderingContext2D,
  pt: Point,
  color: string,
  label: string,
  radius: number,
) {
  // Glow
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle =
    color === "red" ? "rgba(255,80,80,0.15)" : "rgba(80,80,255,0.15)";
  ctx.fill();

  // Filled circle
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color === "red" ? "#ef4444" : "#3b82f6";
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Label
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  ctx.fillText(label, pt.x, pt.y - radius - 8);
}

function drawTipOnly(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  dartNum: number,
) {
  // Draw the tip point
  drawPoint(ctx, tip, "red", "T", 8);

  // Dashed circle to indicate "no tail"
  ctx.save();
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 22, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.restore();

  // Dart number + "no tail" indicator
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(245, 158, 11, 0.9)";
  ctx.fillText(`#${dartNum} (tip only)`, tip.x, tip.y + 32);
}

function drawDartVector(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  tail: Point,
  dartNum: number,
) {
  // Line between tip and tail
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tail.x, tail.y);
  ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Draw points
  drawPoint(ctx, tip, "red", "T", 8);
  drawPoint(ctx, tail, "blue", "F", 8);

  // Dart number label at midpoint
  const mx = (tip.x + tail.x) / 2;
  const my = (tip.y + tail.y) / 2;
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(250, 204, 21, 0.9)";
  ctx.fillText(`#${dartNum}`, mx, my - 14);
}

/** Draw a point inside the zoom canvas. */
function drawZoomPoint(
  ctx: CanvasRenderingContext2D,
  pt: Point,
  sx: number,
  sy: number,
  color: string,
  label: string,
) {
  const zx = ((pt.x - sx) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
  const zy = ((pt.y - sy) / (ZOOM_SRC * 2)) * ZOOM_DISPLAY;
  if (zx < -20 || zx > ZOOM_DISPLAY + 20 || zy < -20 || zy > ZOOM_DISPLAY + 20) return;

  ctx.beginPath();
  ctx.arc(zx, zy, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = "bold 10px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  ctx.fillText(label, zx, zy - 12);
}
