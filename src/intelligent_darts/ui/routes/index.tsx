import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DartBoard } from "@/components/darts/DartBoard";
import type { DartBoardHit } from "@/components/darts/DartBoard";
import { ScoreDisplay } from "@/components/darts/ScoreDisplay";
import type { DartThrow } from "@/components/darts/ScoreDisplay";
import { Leaderboard } from "@/components/darts/Leaderboard";
import { segmentHitPoint } from "@/lib/segment-hitpoint";
import { scoreFromPixel } from "@/lib/board-scoring";
import type { Matrix3x3 } from "@/lib/homography";
import { Link } from "@tanstack/react-router";
import type { DetectionCameraOut, DetectedDartOut, CameraSettingsOut, DetectionOut } from "@/lib/api";
import {
  getCalibration,
  getCameraSettings,
  CameraMode,
  useGetLeaderboard,
  getLeaderboardKey,
  createGame,
  saveTurn,
} from "@/lib/api";
import { KinesisCameraFeed } from "@/components/kinesis/KinesisCameraFeed";
import {
  RotateCcw,
  MessageSquare,
  MessageSquareOff,
  Crosshair,
  Settings,
  Tag,
  ScanEye,
  Loader2,
  Video,
  X,
  ChevronLeft,
  ChevronRight,
  Move,
  Check,
  Database,
  Trash2,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/")({
  component: Index,
});

// ── Camera slot types (same as settings/live-feed) ──────────────────────────

interface CameraSlot {
  deviceId: string;
  calibration: { points: unknown[]; matrix: number[][] } | null;
}

const NUM_CAMERAS = 3;
const STORAGE_KEY = "darts_camera_slots";

type AutoDetectPhase = "off" | "idle" | "detecting" | "paused";
const AUTO_DETECT_STORAGE_KEY = "darts_auto_detect_enabled";

const AUTO_POLL_INTERVAL_MS = 500;
const REMOVAL_COOLDOWN_MS = 2000;
const MATCH_RADIUS_MM = 25;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function loadSlots(): CameraSlot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CameraSlot[];
      while (parsed.length < NUM_CAMERAS)
        parsed.push({ deviceId: "", calibration: null });
      return parsed.slice(0, NUM_CAMERAS);
    }
  } catch {
    /* ignore */
  }
  return Array.from({ length: NUM_CAMERAS }, () => ({
    deviceId: "",
    calibration: null,
  }));
}

// ── Snapshot helper ─────────────────────────────────────────────────────────

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.92): Blob {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const parts = dataUrl.split(",");
  const byteString = atob(parts[1]);
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

function createPlaceholderBlob(): Blob {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 1, 1);
  return canvasToJpegBlob(c, 0.5);
}

// ── Mini camera feed ────────────────────────────────────────────────────────

function MiniCameraFeed({
  deviceId,
  videoRef,
}: {
  deviceId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (!cancelled) setReady(true);
          };
        }
      } catch {
        /* camera busy or denied */
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
    };
  }, [deviceId, videoRef]);

  if (!deviceId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted/30">
        <Video className="w-4 h-4 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
        </div>
      )}
    </div>
  );
}

// ── Camera Detection Overlay Dialog ─────────────────────────────────────────

interface DetectionDialogProps {
  camId: number;
  imageDataUrl: string | null;
  camResult: DetectionCameraOut | undefined;
  isChosen: boolean;
  onClose: () => void;
  onNavigate: (direction: "prev" | "next") => void;
  calibrationMatrix: number[][] | null;
  onApplyCorrection?: (dartIndex: number, newScore: { value: number; label: string; segmentId: string; boardX: number; boardY: number }) => void;
  onAddToLabelingSet?: (camId: number, darts: Array<{ tipX: number; tipY: number; tailX: number; tailY: number; tailVisible: boolean }>) => void;
}

function CameraDetectionDialog({
  camId,
  imageDataUrl,
  camResult,
  isChosen,
  onClose,
  onNavigate,
  calibrationMatrix,
  onApplyCorrection,
  onAddToLabelingSet,
}: DetectionDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [adjustMode, setAdjustMode] = useState(false);
  const [selectedDart, setSelectedDart] = useState<number | null>(null);
  const [addingToLabeling, setAddingToLabeling] = useState(false);

  // Mutable dart positions in image-pixel coords (source of truth while adjusting)
  const [dartPositions, setDartPositions] = useState<
    Array<{ tipX: number; tipY: number; tailX: number | null; tailY: number | null }>
  >([]);

  // Dragging state
  const draggingRef = useRef<{ dartIdx: number; point: "tip" | "tail" } | null>(null);

  // Initialize dart positions from detection result
  useEffect(() => {
    const darts = camResult?.darts ?? [];
    setDartPositions(
      darts.map((d) => ({
        tipX: d.tip?.x ?? 0,
        tipY: d.tip?.y ?? 0,
        tailX: d.tail?.x ?? null,
        tailY: d.tail?.y ?? null,
      })),
    );
    setAdjustMode(false);
    setSelectedDart(null);
  }, [camResult]);

  // Load the snapshot image
  useEffect(() => {
    if (!imageDataUrl) return;
    setLoaded(false);
    const img = new window.Image();
    img.onload = () => {
      imgRef.current = img;
      setLoaded(true);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  // Draw detections on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    const darts = camResult?.darts ?? [];
    const imgW = camResult?.image_width ?? img.naturalWidth;
    const imgH = camResult?.image_height ?? img.naturalHeight;
    const scaleX = img.naturalWidth / imgW;
    const scaleY = img.naturalHeight / imgH;

    for (let i = 0; i < darts.length; i++) {
      if (i >= dartPositions.length) continue;
      const dart = darts[i];
      const pos = dartPositions[i];
      const color = DART_COLORS[i % DART_COLORS.length];
      const isSelected = adjustMode && selectedDart === i;

      const tipX = (pos?.tipX ?? dart.tip?.x ?? 0) * scaleX;
      const tipY = (pos?.tipY ?? dart.tip?.y ?? 0) * scaleY;
      const hasTail = pos ? pos.tailX != null : dart.tail != null;
      const tailX = hasTail ? ((pos?.tailX ?? dart.tail?.x ?? 0) * scaleX) : 0;
      const tailY = hasTail ? ((pos?.tailY ?? dart.tail?.y ?? 0) * scaleY) : 0;

      if (!adjustMode && dart.bbox) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        const bx = dart.bbox.x1 * scaleX;
        const by = dart.bbox.y1 * scaleY;
        const bw = (dart.bbox.x2 - dart.bbox.x1) * scaleX;
        const bh = (dart.bbox.y2 - dart.bbox.y1) * scaleY;
        ctx.strokeRect(bx, by, bw, bh);

        const label = dart.score_label
          ? `${dart.score_label} (${dart.score_value ?? "?"}) ${((dart.confidence ?? 0) * 100).toFixed(0)}%`
          : `Dart ${i + 1} ${((dart.confidence ?? 0) * 100).toFixed(0)}%`;
        ctx.font = "bold 16px system-ui, sans-serif";
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by - 22, textW + 8, 22);
        ctx.fillStyle = "white";
        ctx.fillText(label, bx + 4, by - 6);
      }

      if (hasTail) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tailX, tailY);
        ctx.strokeStyle = isSelected ? "rgba(250, 204, 21, 1)" : "rgba(250, 204, 21, 0.8)";
        ctx.lineWidth = isSelected ? 3 : 2.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
      const tipRadius = isSelected ? 12 : 8;
      ctx.beginPath();
      ctx.arc(tipX, tipY, tipRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#fbbf24" : "white";
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();
      ctx.font = "bold 12px system-ui";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.fillText(`TIP ${i + 1}`, tipX, tipY - (tipRadius + 6));
      ctx.textAlign = "start";

      if (hasTail) {
        const tailRadius = isSelected ? 11 : 7;
        ctx.beginPath();
        ctx.arc(tailX, tailY, tailRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#fbbf24" : "white";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        ctx.font = "bold 12px system-ui";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText(`TAIL ${i + 1}`, tailX, tailY - (tailRadius + 5));
        ctx.textAlign = "start";
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(tipX, tipY, tipRadius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(251, 191, 36, 0.6)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [loaded, camResult, adjustMode, selectedDart, dartPositions]);

  // Convert canvas click/mouse to image-pixel coords
  const toImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) return null;
      const rect = canvas.getBoundingClientRect();
      const imgW = camResult?.image_width ?? img.naturalWidth;
      const imgH = camResult?.image_height ?? img.naturalHeight;
      const scaleX = img.naturalWidth / imgW;
      const scaleY = img.naturalHeight / imgH;
      const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
      return { x: cx / scaleX, y: cy / scaleY };
    },
    [camResult],
  );

  const DRAG_HIT_RADIUS = 20;

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!adjustMode) return;
      const pt = toImageCoords(e);
      if (!pt) return;

      const imgW = camResult?.image_width ?? imgRef.current?.naturalWidth ?? 1;
      const scaleX = (imgRef.current?.naturalWidth ?? imgW) / imgW;
      const scaleY = (imgRef.current?.naturalHeight ?? (camResult?.image_height ?? 1)) / (camResult?.image_height ?? 1);

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const displayScale = canvasRect ? (imgRef.current?.naturalWidth ?? 1) / canvasRect.width : 1;
      const hitRadius = DRAG_HIT_RADIUS * displayScale;

      let bestDist = Infinity;
      let bestDartIdx = -1;
      let bestPoint: "tip" | "tail" = "tip";

      for (let i = 0; i < dartPositions.length; i++) {
        const pos = dartPositions[i];
        if (!pos) continue;
        const dtTip = Math.hypot((pt.x - pos.tipX) * scaleX, (pt.y - pos.tipY) * scaleY);
        if (dtTip < hitRadius && dtTip < bestDist) {
          bestDist = dtTip;
          bestDartIdx = i;
          bestPoint = "tip";
        }
        if (pos.tailX != null && pos.tailY != null) {
          const dtTail = Math.hypot((pt.x - pos.tailX) * scaleX, (pt.y - pos.tailY) * scaleY);
          if (dtTail < hitRadius && dtTail < bestDist) {
            bestDist = dtTail;
            bestDartIdx = i;
            bestPoint = "tail";
          }
        }
      }

      if (bestDartIdx >= 0) {
        setSelectedDart(bestDartIdx);
        draggingRef.current = { dartIdx: bestDartIdx, point: bestPoint };
        e.preventDefault();
      }
    },
    [adjustMode, dartPositions, toImageCoords, camResult],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      const pt = toImageCoords(e);
      if (!pt) return;
      const { dartIdx, point } = draggingRef.current;
      setDartPositions((prev) => {
        const next = [...prev];
        const p = { ...next[dartIdx] };
        if (point === "tip") {
          p.tipX = pt.x;
          p.tipY = pt.y;
        } else {
          p.tailX = pt.x;
          p.tailY = pt.y;
        }
        next[dartIdx] = p;
        return next;
      });
    },
    [toImageCoords],
  );

  const handleCanvasMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const handleApply = useCallback(() => {
    if (selectedDart == null || !calibrationMatrix) return;
    const pos = dartPositions[selectedDart];
    if (!pos) return;
    const result = scoreFromPixel(calibrationMatrix as Matrix3x3, { x: pos.tipX, y: pos.tipY });
    onApplyCorrection?.(selectedDart, result);
    toast.success(`Corrected dart ${selectedDart + 1}: ${result.label} (${result.value} pts)`);
  }, [selectedDart, dartPositions, calibrationMatrix, onApplyCorrection]);

  const handleRemoveDart = useCallback((idx: number) => {
    setDartPositions((prev) => prev.filter((_, i) => i !== idx));
    if (selectedDart === idx) setSelectedDart(null);
    else if (selectedDart != null && selectedDart > idx) setSelectedDart(selectedDart - 1);
  }, [selectedDart]);

  const handleAddToLabeling = useCallback(async () => {
    if (!onAddToLabelingSet) return;
    setAddingToLabeling(true);
    try {
      const labelDarts = dartPositions
        .filter((p) => p.tipX !== 0 || p.tipY !== 0)
        .map((p) => ({
          tipX: p.tipX,
          tipY: p.tipY,
          tailX: p.tailX ?? 0,
          tailY: p.tailY ?? 0,
          tailVisible: p.tailX != null && p.tailY != null,
        }));
      await onAddToLabelingSet(camId, labelDarts);
    } finally {
      setAddingToLabeling(false);
    }
  }, [onAddToLabelingSet, dartPositions, camId]);

  if (!imageDataUrl) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-background rounded-2xl border border-border shadow-2xl p-8 text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-muted-foreground">No snapshot available for Camera {camId}.</p>
          <button onClick={onClose} className="mt-4 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium">Close</button>
        </div>
      </div>
    );
  }

  const darts = camResult?.darts ?? [];

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-2xl border border-border shadow-2xl max-w-4xl max-h-[90vh] w-full flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate("prev")}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Previous camera"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold text-foreground">
              Camera {camId}
            </h2>
            <button
              onClick={() => onNavigate("next")}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Next camera"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {isChosen && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400">
                Chosen
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {darts.length} dart{darts.length !== 1 ? "s" : ""} detected
            </span>
          </div>
          <div className="flex items-center gap-2">
            {darts.length > 0 && (
              <button
                onClick={() => {
                  setAdjustMode((v) => !v);
                  if (adjustMode) setSelectedDart(null);
                  else if (darts.length > 0) setSelectedDart(0);
                }}
                className={`flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium transition-colors ${
                  adjustMode
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                {adjustMode ? "Adjusting" : "Adjust"}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Canvas with detections */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-2">
          <canvas
            ref={canvasRef}
            className={`max-w-full max-h-full object-contain rounded-lg ${adjustMode ? "cursor-grab" : ""}`}
            style={{ maxHeight: "60vh" }}
            onMouseDown={adjustMode ? handleCanvasMouseDown : undefined}
            onMouseMove={adjustMode ? handleCanvasMouseMove : undefined}
            onMouseUp={adjustMode ? handleCanvasMouseUp : undefined}
            onMouseLeave={adjustMode ? handleCanvasMouseUp : undefined}
          />
        </div>

        {/* Dart list + actions */}
        {darts.length > 0 && (
          <div className="px-5 py-3 border-t border-border">
            <div className="flex flex-wrap gap-2 mb-2">
              {darts.map((dart, i) => {
                if (i >= dartPositions.length) return null;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer hover:bg-accent/40 ${
                      adjustMode && selectedDart === i
                        ? "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/30"
                        : "border-border bg-card/60"
                    }`}
                    onClick={() => {
                      if (!adjustMode) {
                        setAdjustMode(true);
                        setSelectedDart(i);
                      } else {
                        setSelectedDart(i);
                      }
                    }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DART_COLORS[i % DART_COLORS.length] }} />
                    <span className="font-semibold text-foreground">
                      {dart.score_label ?? "?"}
                    </span>
                    <span className="text-muted-foreground">
                      {dart.score_value != null ? `${dart.score_value} pts` : "no score"}
                    </span>
                    <span className="text-muted-foreground/60">
                      {((dart.confidence ?? 0) * 100).toFixed(0)}%
                    </span>
                    {adjustMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveDart(i);
                        }}
                        className="ml-1 p-0.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove this detection"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Adjust-mode actions */}
            {adjustMode && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleApply}
                  disabled={selectedDart == null || !calibrationMatrix}
                  className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Apply
                </button>
                <button
                  onClick={handleAddToLabeling}
                  disabled={addingToLabeling}
                  className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {addingToLabeling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Database className="w-3.5 h-3.5" />
                  )}
                  Add to labeling set
                </button>
                <p className="text-[10px] text-muted-foreground ml-2">
                  Click any dart to select, drag tip/tail to move, trash to remove
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const DART_COLORS = ["#a855f7", "#06b6d4", "#f59e0b", "#ef4444", "#22c55e"];

// --- Commentary engine ---

function getCommentary(dart: DartThrow, dartIndex: number, allDarts: DartThrow[]): string {
  const { value, label } = dart;
  const runningTotal = allDarts.reduce((s, d) => s + d.value, 0);

  if (label === "MISS") {
    const misses = ["Off the board! That's a miss.", "No score! Outside the wire.", "A miss -- regroup and refocus.", "Wide of the mark! Zero points."];
    return misses[Math.floor(Math.random() * misses.length)];
  }

  if (label === "D-BULL") return "DOUBLE BULL! Right in the heart!";
  if (label === "BULL") return "Outer bull -- steady hand!";
  if (value === 60) return "Treble twenty! That's the big one!";
  if (value >= 54) return `${label} -- lovely treble!`;
  if (label.startsWith("T") && value >= 36) return `Nice treble! ${label} for ${value}.`;
  if (label.startsWith("T")) return `Treble ${label.slice(1)} -- not bad at all.`;
  if (label.startsWith("D") && value >= 32) return `Big double! ${label} scores ${value}.`;
  if (label.startsWith("D")) return `Double ${label.slice(1)} -- finding the wire.`;

  if (value >= 17) return `Solid ${value}. Keep it going.`;
  if (value >= 10) return `${value} on the board. Decent.`;
  if (value >= 5) return `Just a ${value} -- room for improvement.`;
  if (value >= 1) return `Only ${value}... shake it off.`;

  if (dartIndex === 2) {
    if (runningTotal >= 180) return "ONE HUNDRED AND EIGHTY!";
    if (runningTotal >= 140) return `${runningTotal}! Championship-level scoring!`;
    if (runningTotal >= 100) return `Ton-plus! ${runningTotal} is a great round.`;
  }

  return `${value} scored.`;
}

function getRoundEndComment(total: number): string {
  if (total >= 180) return "ONE HUNDRED AND EIGHTY! Perfection!";
  if (total >= 140) return `${total}! That's a championship round!`;
  if (total >= 100) return `Ton-plus with ${total}! Well played.`;
  if (total >= 60) return `${total} for the round. Respectable.`;
  if (total >= 30) return `${total} total. You can do better.`;
  return `${total}... let's forget that round.`;
}

// --- Main component ---

function Index() {
  const queryClient = useQueryClient();
  const { data: leaderboardRes, isLoading: leaderboardLoading } = useGetLeaderboard();
  const leaderboard = leaderboardRes?.data ?? [];

  const [currentDarts, setCurrentDarts] = useState<DartThrow[]>([]);
  const [boardHits, setBoardHits] = useState<DartBoardHit[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [commentary, setCommentary] = useState("Step up to the oche...");
  const [commentaryVisible, setCommentaryVisible] = useState(true);
  const [commentaryKey, setCommentaryKey] = useState(0);
  const [manualClickEnabled, setManualClickEnabled] = useState(true);

  // ── AI Commentary state ──────────────────────────────────────────────────
  const [aiCommentaryEnabled, setAiCommentaryEnabled] = useState(false);
  const [aiModel, setAiModel] = useState("gemini-2-5-flash");
  const [aiCommentary, setAiCommentary] = useState<string | null>(null);
  const [aiCommentaryLoading, setAiCommentaryLoading] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsTone, setTtsTone] = useState<"enthusiastic" | "warm">("enthusiastic");
  const [detecting, setDetecting] = useState(false);

  const [autoDetectEnabled, setAutoDetectEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AUTO_DETECT_STORAGE_KEY);
      return raw == null ? true : raw === "true";
    } catch {
      return true;
    }
  });
  const [autoDetectPhase, setAutoDetectPhase] = useState<AutoDetectPhase>(
    autoDetectEnabled ? "idle" : "off",
  );
  const [autoDetectPausedReason, setAutoDetectPausedReason] = useState<string | null>(null);

  const currentDartsRef = useRef<DartThrow[]>([]);
  useEffect(() => {
    currentDartsRef.current = currentDarts;
  }, [currentDarts]);

  const autoInFlightRef = useRef(false);

  // Camera mode (loaded from backend)
  const [cameraSettings, setCameraSettings] = useState<CameraSettingsOut | null>(null);
  const cameraMode = cameraSettings?.mode ?? CameraMode.local;

  useEffect(() => {
    getCameraSettings()
      .then(({ data }) => setCameraSettings(data))
      .catch(() => { /* backend unavailable, default to local */ });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_DETECT_STORAGE_KEY, String(autoDetectEnabled));
    } catch { /* ignore */ }
    autoInFlightRef.current = false;
    setAutoDetectPhase(autoDetectEnabled ? "idle" : "off");
    if (!autoDetectEnabled) setAutoDetectPausedReason(null);
  }, [autoDetectEnabled]);

  // Camera refs — load from localStorage first, then merge backend calibrations
  const [slots, setSlots] = useState<CameraSlot[]>(loadSlots);

  useEffect(() => {
    getCalibration()
      .then(({ data: calData }) => {
        const backendSlots = calData?.slots;
        if (!backendSlots || backendSlots.length === 0) return;
        const hasCalibration = backendSlots.some(
          (s) => s.matrix && s.matrix.length > 0,
        );
        if (!hasCalibration) return;

        setSlots((prev) => {
          const merged: CameraSlot[] = backendSlots.map((s, i) => {
            const local = prev[i];
            if (local?.calibration?.matrix?.length) return local;
            if (s.matrix && s.matrix.length > 0) {
              return {
                deviceId: s.device_id || local?.deviceId || "",
                calibration: {
                  points: (s.points ?? []).map((p) => ({ x: p.x, y: p.y })),
                  matrix: s.matrix as number[][],
                },
              };
            }
            return local || { deviceId: "", calibration: null };
          });
          while (merged.length < NUM_CAMERAS)
            merged.push({ deviceId: "", calibration: null });
          const final = merged.slice(0, NUM_CAMERAS);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(final));
          } catch { /* ignore */ }
          return final;
        });
      })
      .catch(() => { /* backend unavailable, use localStorage */ });
  }, []);
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const videoRef3 = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef([videoRef1, videoRef2, videoRef3]);

  // Detection results state (for camera overlays)
  const [lastDetectionResult, setLastDetectionResult] = useState<{
    cameras: DetectionCameraOut[];
    chosenCamId: number | null;
    snapshots: (string | null)[]; // data URLs per camera
    blobs: (Blob | null)[]; // JPEG blobs per camera (for labeling upload)
  } | null>(null);

  // Which camera overlay dialog is open (null = closed)
  const [overlayCamera, setOverlayCamera] = useState<number | null>(null);

  const hasAnyCameras =
    cameraMode === CameraMode.kinesis
      ? (cameraSettings?.channels ?? []).some((ch) => ch.channel_name?.trim())
      : slots.some((s) => s.deviceId);
  const hasAnyCalibration = slots.some((s) => s.calibration);

  const roundComplete = currentDarts.length >= 3;

  const pauseAutoDetect = useCallback((reason: string) => {
    setAutoDetectPausedReason(reason);
    autoInFlightRef.current = false;
    setAutoDetectPhase("paused");
  }, []);

  const resumeAutoDetect = useCallback(() => {
    setAutoDetectPausedReason(null);
    autoInFlightRef.current = false;
    setAutoDetectPhase(autoDetectEnabled ? "idle" : "off");
  }, [autoDetectEnabled]);

  function distMm(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function asAutoThrow(d: DetectedDartOut): DartThrow | null {
    if (d.score_value == null) return null;
    if (d.board_x == null || d.board_y == null) return null;
    return {
      value: d.score_value,
      label: d.score_label ?? "?",
      source: "auto",
      boardX: d.board_x,
      boardY: d.board_y,
      segmentId: d.segment_id ?? undefined,
      confidence: d.confidence ?? undefined,
    };
  }

  function getAutoDartsWithCoords(darts: DartThrow[]) {
    return darts.filter(
      (t) => t.source === "auto" && t.boardX != null && t.boardY != null,
    ) as Array<Required<Pick<DartThrow, "boardX" | "boardY">> & DartThrow>;
  }

  const autoStatus = useMemo(() => {
    if (!autoDetectEnabled) return { text: "Off", className: "text-muted-foreground" };
    if (autoDetectPausedReason) return { text: "Paused", className: "text-amber-500" };
    if (!hasAnyCameras) return { text: "No cameras", className: "text-muted-foreground" };
    if (!hasAnyCalibration) return { text: "No calibration", className: "text-muted-foreground" };
    if (roundComplete) return { text: "Round complete", className: "text-muted-foreground" };

    switch (autoDetectPhase) {
      case "detecting":
        return { text: "Detecting…", className: "text-violet-500 animate-pulse" };
      case "idle":
      default:
        return { text: "Active", className: "text-emerald-500" };
    }
  }, [
    autoDetectEnabled,
    autoDetectPausedReason,
    hasAnyCameras,
    hasAnyCalibration,
    roundComplete,
    autoDetectPhase,
  ]);

  // ── AI Commentary helpers ────────────────────────────────────────────────

  // Preload voices — Chrome loads them asynchronously
  const [voicesReady, setVoicesReady] = useState(false);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) setVoicesReady(true);
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const speakText = useCallback(
    (text: string) => {
      if (!ttsEnabled || !("speechSynthesis" in window)) return;
      // Chrome bug: synth can get "stuck" — cancel + resume to unstick
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      // Pick an English voice if available
      const voices = window.speechSynthesis.getVoices();
      const englishVoice = voices.find((v) => v.lang.startsWith("en") && v.default)
        || voices.find((v) => v.lang.startsWith("en"));
      if (englishVoice) utterance.voice = englishVoice;
      if (ttsTone === "enthusiastic") {
        utterance.pitch = 1.2;
        utterance.rate = 1.3;
      } else {
        utterance.pitch = 1.0;
        utterance.rate = 0.9;
      }
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    },
    [ttsEnabled, ttsTone, voicesReady],
  );

  const fetchAiCommentary = useCallback(
    async (
      scoreLabel: string,
      scoreValue: number,
      roundScores?: { value: number; label: string }[],
    ) => {
      if (!aiCommentaryEnabled) return;
      setAiCommentaryLoading(true);
      try {
        const payload: Record<string, unknown> = {
          score_label: scoreLabel,
          score_value: scoreValue,
          model: aiModel,
        };
        if (roundScores) {
          payload.round_scores = roundScores.map((s) => ({
            value: s.value,
            label: s.label,
          }));
        }
        const res = await fetch("/api/commentary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          setAiCommentary(data.commentary);
          speakText(data.commentary);
        }
      } catch {
        /* fail silently — static commentary still shows */
      } finally {
        setAiCommentaryLoading(false);
      }
    },
    [aiCommentaryEnabled, aiModel, speakText],
  );

  const handleScore = useCallback(
    (value: number, label: string, hit: { x: number; y: number; segmentId: string }) => {
      if (roundComplete) return;
      const newDart: DartThrow = { value, label, source: "manual", segmentId: hit.segmentId, boardX: hit.x, boardY: hit.y };
      const next = [...currentDarts, newDart];
      setCurrentDarts(next);
      setBoardHits((prev) => [...prev, { ...hit, value, label }]);

      const dartComment = getCommentary(newDart, next.length - 1, next);
      if (next.length >= 3) {
        const total = next.reduce((sum, d) => sum + d.value, 0);
        setCommentary(getRoundEndComment(total));
        fetchAiCommentary(label, value, next.map((d) => ({ value: d.value, label: d.label })));
        if (total > top3Threshold || leaderboard.length < 3) {
          setShowNameInput(true);
        }
      } else {
        setCommentary(dartComment);
        fetchAiCommentary(label, value);
      }
      setCommentaryKey((k) => k + 1);
    },
    [currentDarts, roundComplete, top3Threshold, leaderboard.length, fetchAiCommentary],
  );

  // ── Detection helpers ───────────────────────────────────────────────────

  const buildDetectionPayload = useCallback(
    (includeSnapshots: boolean) => {
      const formData = new FormData();
      const snapshots: (string | null)[] = [];
      const blobs: (Blob | null)[] = [];

      let capturedCount = 0;
      for (let i = 0; i < NUM_CAMERAS; i++) {
        const video = videoRefs.current[i].current;
        if (video && video.videoWidth > 0 && video.srcObject) {
          const scale = Math.min(1, 1280 / video.videoWidth);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = canvasToJpegBlob(canvas, 0.85);
          formData.append(`cam${i + 1}`, blob, `cam${i + 1}.jpg`);
          snapshots.push(includeSnapshots ? canvas.toDataURL("image/jpeg", 0.85) : null);
          blobs.push(blob);
          capturedCount++;
        } else {
          const placeholder = createPlaceholderBlob();
          formData.append(`cam${i + 1}`, placeholder, `cam${i + 1}.jpg`);
          snapshots.push(null);
          blobs.push(null);
        }

        const cal = slots[i].calibration;
        if (cal?.matrix) {
          formData.append(`calibration${i + 1}`, JSON.stringify(cal.matrix));
        }
      }

      return { formData, snapshots, blobs, capturedCount };
    },
    [slots],
  );

  const runDetectionRequest = useCallback(
    async (includeSnapshots: boolean) => {
      const { formData, snapshots, blobs, capturedCount } = buildDetectionPayload(includeSnapshots);
      if (capturedCount === 0) {
        throw new Error(
          "No cameras are producing video. Check that cameras are connected and streams are active.",
        );
      }

      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), 45_000);
      const res = await fetch("/api/detection", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(fetchTimer);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const result = (await res.json()) as DetectionOut;
      return { result, snapshots, blobs };
    },
    [buildDetectionPayload],
  );

  function detectedAutoThrows(result: DetectionOut): DartThrow[] {
    const darts: DetectedDartOut[] = result.darts ?? [];
    const scored = darts.filter((d) => d.score_value != null);
    return scored.map(asAutoThrow).filter(Boolean) as DartThrow[];
  }

  function computeNewAutoThrows(prevDarts: DartThrow[], detected: DartThrow[]) {
    const existingAuto = getAutoDartsWithCoords(prevDarts);

    const removalDetected =
      existingAuto.length > 0 &&
      existingAuto.some(
        (ex) =>
          !detected.some(
            (d) =>
              d.boardX != null &&
              d.boardY != null &&
              distMm(ex.boardX, ex.boardY, d.boardX, d.boardY) < MATCH_RADIUS_MM,
          ),
      );

    const newCandidates = detected.filter(
      (d) =>
        d.boardX != null &&
        d.boardY != null &&
        !existingAuto.some(
          (ex) => distMm(ex.boardX, ex.boardY, d.boardX!, d.boardY!) < MATCH_RADIUS_MM,
        ),
    );
    newCandidates.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    return { removalDetected, newCandidates };
  }

  const appendDarts = useCallback(
    (toAdd: DartThrow[], chosenCamId: number | null, toastPrefix: string) => {
      const prev = currentDartsRef.current;
      if (prev.length >= 3) return;

      const slotsRemaining = 3 - prev.length;
      const dartsToAdd = toAdd.slice(0, slotsRemaining);
      if (dartsToAdd.length === 0) return;

      const newHits: DartBoardHit[] = dartsToAdd.map((d) => {
        const hitPt = segmentHitPoint(d.segmentId ?? "miss", d.boardX, d.boardY);
        return {
          x: hitPt.x,
          y: hitPt.y,
          segmentId: d.segmentId ?? "miss",
          value: d.value,
          label: d.label,
        };
      });

      const allDarts = [...prev, ...dartsToAdd];
      setCurrentDarts(allDarts);
      setBoardHits((prevHits) => [...prevHits, ...newHits]);

      const lastDart = dartsToAdd[dartsToAdd.length - 1];
      if (allDarts.length >= 3) {
        const total = allDarts.reduce((sum, d) => sum + d.value, 0);
        setCommentary(getRoundEndComment(total));
        fetchAiCommentary(lastDart.label, lastDart.value, allDarts.map((d) => ({ value: d.value, label: d.label })));
        if (total > top3Threshold || leaderboard.length < 3) {
          setShowNameInput(true);
        }
      } else {
        setCommentary(getCommentary(lastDart, allDarts.length - 1, allDarts));
        fetchAiCommentary(lastDart.label, lastDart.value);
      }
      setCommentaryKey((k) => k + 1);

      const labels = dartsToAdd.map((d) => d.label).join(", ");
      const camSuffix = chosenCamId ? ` (Cam ${chosenCamId})` : "";
      toast.success(
        `${toastPrefix} ${dartsToAdd.length} dart${dartsToAdd.length !== 1 ? "s" : ""}: ${labels}${camSuffix}`,
      );
    },
    [leaderboard.length, top3Threshold, fetchAiCommentary],
  );

  const applyDetectionOut = useCallback(
    (result: DetectionOut, snapshots: (string | null)[], mode: "manual" | "auto", blobs?: (Blob | null)[]) => {
      setLastDetectionResult({
        cameras: result.cameras ?? [],
        chosenCamId: result.chosen_cam_id ?? null,
        snapshots,
        blobs: blobs ?? snapshots.map(() => null),
      });

      const darts: DetectedDartOut[] = result.darts ?? [];
      if (darts.length === 0) {
        const totalRawDarts = (result.cameras ?? []).reduce(
          (sum: number, c: DetectionCameraOut) => sum + (c.darts?.length ?? 0),
          0,
        );
        if (totalRawDarts > 0) {
          toast.warning(
            `Detected ${totalRawDarts} dart(s) but calibration is missing or invalid. Go to Settings → Calibrate cameras.`,
          );
        } else {
          toast.warning("No darts detected. Make sure darts are visible to the cameras.");
        }
        return;
      }

      const scoredDarts = darts.filter((d) => d.score_value != null);
      if (scoredDarts.length === 0) {
        toast.warning(`Detected ${darts.length} dart(s) but could not score them — check calibration.`);
        return;
      }

      const detected = detectedAutoThrows(result);
      if (detected.length === 0) {
        toast.warning("Detected darts but could not map them onto the board — check calibration.");
        return;
      }

      const prev = currentDartsRef.current;
      const { removalDetected, newCandidates } = computeNewAutoThrows(prev, detected);

      if (mode === "auto" && removalDetected) {
        pauseAutoDetect("Dart(s) were removed or moved. Press Reset to continue.");
        toast.warning("Dart(s) were removed or moved — auto-detection paused. Press Reset to continue.");
        return;
      }

      if (newCandidates.length === 0) {
        if (mode === "manual") toast.info("No new darts to add.");
        return;
      }

      appendDarts(newCandidates, result.chosen_cam_id ?? null, mode === "auto" ? "Auto added" : "Added");
    },
    [appendDarts, pauseAutoDetect],
  );

  // ── Manual detection handler ────────────────────────────────────────────

  const handleDetection = useCallback(async () => {
    if (roundComplete || detecting) return;

    if (!hasAnyCameras) {
      toast.error("No cameras assigned. Go to Settings to configure cameras.");
      return;
    }
    if (!hasAnyCalibration) {
      toast.error("No cameras calibrated. Go to Settings → Calibrate at least one camera.");
      return;
    }

    setDetecting(true);
    const safetyTimer = setTimeout(() => {
      setDetecting(false);
      toast.error("Detection timed out. Please try again.");
    }, 60_000);

    try {
      const { result, snapshots, blobs } = await runDetectionRequest(true);
      applyDetectionOut(result, snapshots, "manual", blobs);
    } catch (err) {
      console.error("[detection] Error:", err);
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("Detection timed out. The first run may be slow while the model loads — try again.");
      } else {
        toast.error("Detection failed: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    } finally {
      clearTimeout(safetyTimer);
      setDetecting(false);
    }
  }, [roundComplete, detecting, hasAnyCameras, hasAnyCalibration, runDetectionRequest, applyDetectionOut]);

  // ── Auto detection (motion → settle → detect) ───────────────────────────

  useEffect(() => {
    const eligible =
      autoDetectEnabled &&
      !autoDetectPausedReason &&
      hasAnyCameras &&
      hasAnyCalibration;

    if (!eligible) {
      if (!autoDetectEnabled) setAutoDetectPhase("off");
      else if (autoDetectPausedReason) setAutoDetectPhase("paused");
      else setAutoDetectPhase("idle");
      return;
    }

    setAutoDetectPhase("idle");
    let cancelled = false;

    const runPollCycle = async () => {
      while (!cancelled) {
        await sleep(AUTO_POLL_INTERVAL_MS);
        if (cancelled) break;
        if (autoInFlightRef.current) continue;

        autoInFlightRef.current = true;
        setAutoDetectPhase("detecting");

        try {
          const prev = currentDartsRef.current;

          const { result, snapshots } = await runDetectionRequest(true);
          if (cancelled) break;

          const detected = detectedAutoThrows(result);
          const { removalDetected, newCandidates } = computeNewAutoThrows(prev, detected);

          const boardChanged =
            removalDetected ||
            (prev.length >= 3 && detected.length !== prev.length);

          if (boardChanged) {
            toast.warning("Board change detected — resetting in 2s…");
            setAutoDetectPhase("paused");
            autoInFlightRef.current = false;
            await sleep(REMOVAL_COOLDOWN_MS);
            if (cancelled) break;
            setCurrentDarts([]);
            setBoardHits([]);
            setPlayerName("");
            setShowNameInput(false);
            setCommentary("Step up to the oche...");
            setCommentaryKey((k) => k + 1);
            setLastDetectionResult(null);
            setAutoDetectPausedReason(null);
            setAutoDetectPhase("idle");
            continue;
          }

          setLastDetectionResult({
            cameras: result.cameras ?? [],
            chosenCamId: result.chosen_cam_id ?? null,
            snapshots,
            blobs: snapshots.map(() => null),
          });

          if (newCandidates.length > 0 && prev.length < 3) {
            appendDarts(newCandidates.slice(0, 1), result.chosen_cam_id ?? null, "Auto added");
          }
        } catch (err) {
          if (cancelled) break;
          console.error("[auto-detect] Error:", err);
        } finally {
          autoInFlightRef.current = false;
          if (!cancelled) setAutoDetectPhase("idle");
        }
      }
    };

    void runPollCycle();
    return () => { cancelled = true; };
  }, [
    autoDetectEnabled,
    autoDetectPausedReason,
    hasAnyCameras,
    hasAnyCalibration,
    runDetectionRequest,
    appendDarts,
  ]);

  // ── Correction callbacks (from CameraDetectionDialog) ──────────────────

  const handleApplyCorrection = useCallback(
    (dartIndex: number, newScore: { value: number; label: string; segmentId: string; boardX: number; boardY: number }) => {
      if (!lastDetectionResult) return;
      const chosenCamId = lastDetectionResult.chosenCamId;
      const camResult = lastDetectionResult.cameras.find((c) => c.cam_id === chosenCamId);
      if (!camResult) return;

      const detDart = (camResult.darts ?? [])[dartIndex];
      if (!detDart) return;

      // Find which round dart this detection dart corresponds to by matching board coords
      const roundIdx = currentDarts.findIndex(
        (d) =>
          d.source === "auto" &&
          d.boardX != null &&
          d.boardY != null &&
          detDart.board_x != null &&
          detDart.board_y != null &&
          Math.hypot(d.boardX - detDart.board_x, d.boardY - detDart.board_y) < MATCH_RADIUS_MM,
      );

      if (roundIdx < 0) {
        toast.warning("Could not match this dart to a scored round dart.");
        return;
      }

      // Update currentDarts
      setCurrentDarts((prev) => {
        const next = [...prev];
        next[roundIdx] = {
          ...next[roundIdx],
          value: newScore.value,
          label: newScore.label,
          boardX: newScore.boardX,
          boardY: newScore.boardY,
          segmentId: newScore.segmentId,
        };
        return next;
      });

      // Update boardHits
      const hitPt = segmentHitPoint(newScore.segmentId, newScore.boardX, newScore.boardY);
      setBoardHits((prev) => {
        const next = [...prev];
        next[roundIdx] = {
          x: hitPt.x,
          y: hitPt.y,
          segmentId: newScore.segmentId,
          value: newScore.value,
          label: newScore.label,
        };
        return next;
      });

      // Update detection result so overlay stays consistent
      setLastDetectionResult((prev) => {
        if (!prev) return prev;
        const cameras = prev.cameras.map((c) => {
          if (c.cam_id !== chosenCamId) return c;
          const darts = (c.darts ?? []).map((d, i) => {
            if (i !== dartIndex) return d;
            return {
              ...d,
              score_value: newScore.value,
              score_label: newScore.label,
              segment_id: newScore.segmentId,
              board_x: newScore.boardX,
              board_y: newScore.boardY,
            };
          });
          return { ...c, darts };
        });
        return { ...prev, cameras };
      });
    },
    [lastDetectionResult, currentDarts],
  );

  const handleAddToLabelingSet = useCallback(
    async (
      camId: number,
      darts: Array<{ tipX: number; tipY: number; tailX: number; tailY: number; tailVisible: boolean }>,
    ) => {
      if (!lastDetectionResult) return;

      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        "_",
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("");

      // Upload all 3 camera images as a raw capture
      const captureForm = new FormData();
      captureForm.append("timestamp", timestamp);
      for (let i = 0; i < NUM_CAMERAS; i++) {
        const blob = lastDetectionResult.blobs[i];
        if (blob && blob.size > 10) {
          captureForm.append(`cam${i + 1}`, blob, `cam${i + 1}.jpg`);
        } else {
          captureForm.append(`cam${i + 1}`, createPlaceholderBlob(), `cam${i + 1}.jpg`);
        }
      }

      const captureRes = await fetch("/api/raw-captures", {
        method: "POST",
        body: captureForm,
      });
      if (!captureRes.ok) {
        toast.error("Failed to create raw capture for labeling.");
        return;
      }

      // Save labels for the chosen camera
      const camResult = lastDetectionResult.cameras.find((c) => c.cam_id === camId);
      const imgW = camResult?.image_width ?? 1280;
      const imgH = camResult?.image_height ?? 720;
      const imageFilename = `dart_${timestamp}_cam${camId}.jpg`;

      const labelRes = await fetch("/api/labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_filename: imageFilename,
          image_width: imgW,
          image_height: imgH,
          darts: darts.map((d) => ({
            tip: { x: d.tipX, y: d.tipY },
            tail: { x: d.tailVisible ? d.tailX : 0, y: d.tailVisible ? d.tailY : 0 },
            tail_visible: d.tailVisible,
          })),
        }),
      });

      if (!labelRes.ok) {
        toast.error("Capture saved but failed to save labels.");
        return;
      }

      toast.success(`Added to labeling set (${timestamp}). Visit Labeling page to review.`);
    },
    [lastDetectionResult],
  );

  const handleSaveRound = useCallback(async () => {
    if (!playerName.trim()) return;
    const name = playerName.trim();

    // Reset UI immediately so the player can start the next round
    setCurrentDarts([]);
    setBoardHits([]);
    setPlayerName("");
    setShowNameInput(false);
    setCommentary("Step up to the oche...");
    setCommentaryKey((k) => k + 1);
    setLastDetectionResult(null);
    resumeAutoDetect();

    try {
      const { data: game } = await createGame({ player_names: [name], game_mode: "friendly" });
      const player = game.players?.[0];
      if (!player) throw new Error("No player returned from createGame");

      const throws = currentDarts.map((dart, i) => ({
        throw_number: i + 1,
        score_value: dart.value,
        score_label: dart.label,
        board_x: dart.boardX ?? null,
        board_y: dart.boardY ?? null,
        source: dart.source ?? "manual",
        segment_id: dart.segmentId ?? null,
        confidence: dart.confidence ?? null,
      }));

      await saveTurn({ game_id: game.id }, { player_id: player.id, round_number: 1, throws });
      void queryClient.invalidateQueries({ queryKey: getLeaderboardKey() });
    } catch (err) {
      console.error("[handleSaveRound]", err);
      toast.error("Failed to save round to leaderboard.");
    }
  }, [currentDarts, playerName, resumeAutoDetect, queryClient]);

  const handleReset = useCallback(() => {
    setCurrentDarts([]);
    setBoardHits([]);
    setPlayerName("");
    setShowNameInput(false);
    setCommentary("Step up to the oche...");
    setAiCommentary(null);
    setCommentaryKey((k) => k + 1);
    setLastDetectionResult(null);
    resumeAutoDetect();
  }, [resumeAutoDetect]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8 gap-6 relative">
      {/* Settings toggles — fixed top right */}
      <div className="fixed top-[52px] right-4 z-50 flex items-center gap-1">
        <Link
          to="/labeling"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          title="Data Collection & Labeling"
        >
          <Tag className="w-4 h-4" />
        </Link>
        <Link
          to="/settings"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </Link>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          onClick={() => setManualClickEnabled((v) => !v)}
          className={`p-2 rounded-lg transition-colors relative ${manualClickEnabled ? "text-foreground bg-accent/60" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"}`}
          title={manualClickEnabled ? "Manual clicking ON — click to disable" : "Manual clicking OFF — click to enable"}
        >
          <Crosshair className="w-4 h-4" />
          {!manualClickEnabled && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="block w-5 h-0.5 bg-current rotate-45 rounded-full" />
            </span>
          )}
        </button>
        <button
          onClick={() => setCommentaryVisible((v) => !v)}
          className={`p-2 rounded-lg transition-colors ${commentaryVisible ? "text-foreground bg-accent/60" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"}`}
          title={commentaryVisible ? "Commentary ON — click to hide" : "Commentary OFF — click to show"}
        >
          {commentaryVisible ? (
            <MessageSquare className="w-4 h-4" />
          ) : (
            <MessageSquareOff className="w-4 h-4" />
          )}
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <div className="flex items-center gap-1.5 pl-1">
          <Switch
            checked={autoDetectEnabled}
            onCheckedChange={(v) => setAutoDetectEnabled(Boolean(v))}
          />
          <span className={`text-[10px] font-semibold ${autoStatus.className}`}>
            {autoStatus.text}
          </span>
        </div>
      </div>

      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Data Intelligence Darts
        </h1>
        <p className="text-xs text-muted-foreground mt-1 tracking-wide">
          Powered by AI
        </p>
      </div>

      {/* Score display */}
      <ScoreDisplay darts={currentDarts} />

      {/* AI Commentary controls */}
      <div className="flex flex-col items-center gap-2 w-full max-w-lg">
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <div className="flex items-center gap-1.5">
            <Switch
              checked={aiCommentaryEnabled}
              onCheckedChange={(v) => {
                setAiCommentaryEnabled(Boolean(v));
                if (!v) setAiCommentary(null);
              }}
            />
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[11px] font-medium text-muted-foreground">AI Commentary</span>
          </div>

          {aiCommentaryEnabled && (
            <>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="h-7 rounded-md border border-border bg-card/60 px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="gemini-2-5-flash">Gemini 2.5 Flash</option>
                <option value="llama-4-maverick">Llama 4 Maverick</option>
                <option value="gpt-oss-120b">GPT OSS 120B</option>
                <option value="claude-3-7-sonnet">Claude 3.7 Sonnet</option>
              </select>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setTtsEnabled((prev) => {
                      const next = !prev;
                      // Warm-up: speak a silent utterance on user gesture to unlock
                      // Chrome's speech synthesis for subsequent async calls
                      if (next && "speechSynthesis" in window) {
                        const warmup = new SpeechSynthesisUtterance("");
                        warmup.volume = 0;
                        window.speechSynthesis.speak(warmup);
                      }
                      return next;
                    });
                  }}
                  className={`p-1.5 rounded-md transition-colors ${ttsEnabled ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}`}
                  title={ttsEnabled ? "TTS ON" : "TTS OFF"}
                >
                  {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>
                {ttsEnabled && (
                  <select
                    value={ttsTone}
                    onChange={(e) => setTtsTone(e.target.value as "enthusiastic" | "warm")}
                    className="h-7 rounded-md border border-border bg-card/60 px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="enthusiastic">Enthusiastic</option>
                    <option value="warm">Warm & Friendly</option>
                  </select>
                )}
              </div>
            </>
          )}
        </div>

        {/* AI Commentary text */}
        {aiCommentaryEnabled && (aiCommentary || aiCommentaryLoading) && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            {aiCommentaryLoading ? (
              <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
            ) : (
              <p className="text-sm font-medium text-amber-200 italic">{aiCommentary}</p>
            )}
          </div>
        )}
      </div>

      {/* Static commentary — hidden when AI commentary is active */}
      {!aiCommentaryEnabled && (
        <div className="h-6 flex items-center justify-center">
          {commentaryVisible && (
            <p
              key={commentaryKey}
              className="text-sm italic text-muted-foreground text-center animate-in fade-in duration-300"
            >
              {commentary}
            </p>
          )}
        </div>
      )}

      {/* Dartboard */}
      <DartBoard onScore={handleScore} disabled={roundComplete || !manualClickEnabled} hits={boardHits} />

      {/* Detection button + camera strip */}
      <div className="flex flex-col items-center gap-3 w-full max-w-lg">
        {autoDetectPausedReason && (
          <p className="text-[11px] text-amber-600 text-center max-w-[26rem]">
            {autoDetectPausedReason}
          </p>
        )}

        <button
          onClick={handleDetection}
          disabled={detecting || roundComplete}
          className="flex items-center gap-2 h-11 px-6 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg"
        >
          {detecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Detecting...
            </>
          ) : (
            <>
              <ScanEye className="w-4 h-4" />
              Detection
            </>
          )}
        </button>

        {/* Mini camera strip */}
        {hasAnyCameras && hasAnyCalibration && (
          <div className="flex gap-2 w-full">
            {slots.map((slot, idx) => {
              const camId = idx + 1;
              const camResult = lastDetectionResult?.cameras.find((c) => c.cam_id === camId);
              const dartCount = camResult?.darts?.length ?? 0;
              const isChosen = lastDetectionResult?.chosenCamId === camId;

              return (
                <div
                  key={idx}
                  className={`flex-1 rounded-lg border bg-card overflow-hidden cursor-pointer transition-colors hover:border-violet-500/50 ${
                    isChosen ? "border-violet-500/70 ring-1 ring-violet-500/30" : "border-border"
                  }`}
                  onClick={() => {
                    if (lastDetectionResult) {
                      setOverlayCamera(camId);
                    }
                  }}
                  title={lastDetectionResult ? `Click to view Camera ${camId} detections` : undefined}
                >
                  <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/50">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        slot.calibration
                          ? "bg-emerald-400"
                          : (cameraMode === CameraMode.kinesis
                              ? cameraSettings?.channels?.[idx]?.channel_name?.trim()
                              : slot.deviceId)
                            ? "bg-amber-400"
                            : "bg-muted-foreground/30"
                      }`}
                    />
                    <span className="text-[10px] font-medium text-muted-foreground">
                      Cam {camId}
                    </span>
                    {dartCount > 0 && (
                      <span className="ml-auto text-[9px] font-bold text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded-full">
                        {dartCount} dart{dartCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {isChosen && (
                      <span className="text-[9px] font-bold text-violet-400">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="aspect-video">
                    {cameraMode === CameraMode.kinesis ? (
                      <KinesisCameraFeed
                        channelName={cameraSettings?.channels?.[idx]?.channel_name ?? ""}
                        region={cameraSettings?.region ?? "us-east-1"}
                        videoRef={videoRefs.current[idx]}
                      />
                    ) : (
                      <MiniCameraFeed
                        deviceId={slot.deviceId}
                        videoRef={videoRefs.current[idx]}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!hasAnyCalibration && (
          <p className="text-xs text-muted-foreground">
            Configure cameras in{" "}
            <Link to="/settings" className="underline hover:text-foreground">
              Settings
            </Link>{" "}
            first.
          </p>
        )}
      </div>

      {/* Actions below board */}
      <div className="h-9 flex items-center justify-center">
        {showNameInput && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveRound()}
              placeholder="Enter your name"
              autoFocus
              className="h-9 rounded-lg border border-border bg-card/60 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={handleSaveRound}
              disabled={!playerName.trim()}
              className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleReset}
              className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Reset round"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        {currentDarts.length > 0 && !showNameInput && !roundComplete && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}

        {roundComplete && !showNameInput && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {/* Leaderboard */}
      <Leaderboard entries={leaderboard} loading={leaderboardLoading} />

      {/* Camera detection overlay dialog */}
      {overlayCamera !== null && lastDetectionResult && (
        <CameraDetectionDialog
          camId={overlayCamera}
          imageDataUrl={lastDetectionResult.snapshots[overlayCamera - 1] ?? null}
          camResult={lastDetectionResult.cameras.find((c) => c.cam_id === overlayCamera)}
          isChosen={lastDetectionResult.chosenCamId === overlayCamera}
          onClose={() => setOverlayCamera(null)}
          onNavigate={(dir) => {
            setOverlayCamera((prev) => {
              if (prev == null) return null;
              if (dir === "next") return prev >= NUM_CAMERAS ? 1 : prev + 1;
              return prev <= 1 ? NUM_CAMERAS : prev - 1;
            });
          }}
          calibrationMatrix={slots[(overlayCamera ?? 1) - 1]?.calibration?.matrix ?? null}
          onApplyCorrection={handleApplyCorrection}
          onAddToLabelingSet={handleAddToLabelingSet}
        />
      )}
    </div>
  );
}
