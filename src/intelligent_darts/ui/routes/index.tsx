import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DartBoard } from "@/components/darts/DartBoard";
import type { DartBoardHit } from "@/components/darts/DartBoard";
import { ScoreDisplay } from "@/components/darts/ScoreDisplay";
import type { DartThrow } from "@/components/darts/ScoreDisplay";
import { Leaderboard } from "@/components/darts/Leaderboard";
import type { LeaderboardEntry } from "@/components/darts/Leaderboard";
import { segmentHitPoint } from "@/lib/segment-hitpoint";
import { Link } from "@tanstack/react-router";
import type { DetectionCameraOut, DetectedDartOut, CameraSettingsOut } from "@/lib/api";
import { getCalibration, getCameraSettings, CameraMode } from "@/lib/api";
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
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Index,
});

const INITIAL_LEADERBOARD: LeaderboardEntry[] = [
  { name: "Alice", score: 140 },
  { name: "Bob", score: 121 },
  { name: "Charlie", score: 95 },
];

// ── Camera slot types (same as settings/live-feed) ──────────────────────────

interface CameraSlot {
  deviceId: string;
  calibration: { points: unknown[]; matrix: number[][] } | null;
}

const NUM_CAMERAS = 3;
const STORAGE_KEY = "darts_camera_slots";

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

function CameraDetectionDialog({
  camId,
  imageDataUrl,
  camResult,
  isChosen,
  onClose,
}: {
  camId: number;
  imageDataUrl: string | null;
  camResult: DetectionCameraOut | undefined;
  isChosen: boolean;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load the snapshot image
  useEffect(() => {
    if (!imageDataUrl) return;
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
      const dart = darts[i];
      const color = DART_COLORS[i % DART_COLORS.length];

      // Bounding box
      if (dart.bbox) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        const bx = dart.bbox.x1 * scaleX;
        const by = dart.bbox.y1 * scaleY;
        const bw = (dart.bbox.x2 - dart.bbox.x1) * scaleX;
        const bh = (dart.bbox.y2 - dart.bbox.y1) * scaleY;
        ctx.strokeRect(bx, by, bw, bh);

        // Label background
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

      // Tip keypoint
      if (dart.tip) {
        const tx = dart.tip.x * scaleX;
        const ty = dart.tip.y * scaleY;
        ctx.beginPath();
        ctx.arc(tx, ty, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = "bold 12px system-ui";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText("TIP", tx, ty - 14);
        ctx.textAlign = "start";
      }

      // Tail keypoint
      if (dart.tail) {
        const fx = dart.tail.x * scaleX;
        const fy = dart.tail.y * scaleY;
        ctx.beginPath();
        ctx.arc(fx, fy, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = "bold 12px system-ui";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText("TAIL", fx, fy - 12);
        ctx.textAlign = "start";
      }

      // Line between tip and tail
      if (dart.tip && dart.tail) {
        ctx.beginPath();
        ctx.moveTo(dart.tip.x * scaleX, dart.tip.y * scaleY);
        ctx.lineTo(dart.tail.x * scaleX, dart.tail.y * scaleY);
        ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
  }, [loaded, camResult]);

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
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Camera {camId} — Detection Results
            </h2>
            {isChosen && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400">
                Chosen
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {darts.length} dart{darts.length !== 1 ? "s" : ""} detected
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas with detections */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-2">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full object-contain rounded-lg"
            style={{ maxHeight: "65vh" }}
          />
        </div>

        {/* Dart list */}
        {darts.length > 0 && (
          <div className="px-5 py-3 border-t border-border">
            <div className="flex flex-wrap gap-2">
              {darts.map((dart, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card/60 text-xs"
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
                </div>
              ))}
            </div>
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
  const [currentDarts, setCurrentDarts] = useState<DartThrow[]>([]);
  const [boardHits, setBoardHits] = useState<DartBoardHit[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(INITIAL_LEADERBOARD);
  const [playerName, setPlayerName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [commentary, setCommentary] = useState("Step up to the oche...");
  const [commentaryVisible, setCommentaryVisible] = useState(true);
  const [commentaryKey, setCommentaryKey] = useState(0);
  const [manualClickEnabled, setManualClickEnabled] = useState(true);
  const [detecting, setDetecting] = useState(false);

  // Camera mode (loaded from backend)
  const [cameraSettings, setCameraSettings] = useState<CameraSettingsOut | null>(null);
  const cameraMode = cameraSettings?.mode ?? CameraMode.local;

  useEffect(() => {
    getCameraSettings()
      .then(({ data }) => setCameraSettings(data))
      .catch(() => { /* backend unavailable, default to local */ });
  }, []);

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
  } | null>(null);

  // Which camera overlay dialog is open (null = closed)
  const [overlayCamera, setOverlayCamera] = useState<number | null>(null);

  const hasAnyCameras =
    cameraMode === CameraMode.kinesis
      ? (cameraSettings?.channels ?? []).some((ch) => ch.channel_name?.trim())
      : slots.some((s) => s.deviceId);
  const hasAnyCalibration = slots.some((s) => s.calibration);

  const roundComplete = currentDarts.length >= 3;

  const top3Threshold = useMemo(() => {
    const sorted = [...leaderboard].sort((a, b) => b.score - a.score);
    return sorted.length >= 3 ? sorted[2].score : 0;
  }, [leaderboard]);

  const handleScore = useCallback(
    (value: number, label: string, hit: { x: number; y: number; segmentId: string }) => {
      if (roundComplete) return;
      const newDart: DartThrow = { value, label };
      const next = [...currentDarts, newDart];
      setCurrentDarts(next);
      setBoardHits((prev) => [...prev, { ...hit, value, label }]);

      const dartComment = getCommentary(newDart, next.length - 1, next);
      if (next.length >= 3) {
        const total = next.reduce((sum, d) => sum + d.value, 0);
        setCommentary(getRoundEndComment(total));
        if (total > top3Threshold || leaderboard.length < 3) {
          setShowNameInput(true);
        }
      } else {
        setCommentary(dartComment);
      }
      setCommentaryKey((k) => k + 1);
    },
    [currentDarts, roundComplete, top3Threshold, leaderboard.length],
  );

  // ── Detection handler ───────────────────────────────────────────────────

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
      const formData = new FormData();
      const snapshots: (string | null)[] = [];

      // Snapshot each camera
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
          console.log(`[detection] cam${i + 1}: ${canvas.width}x${canvas.height}, blob=${blob.size} bytes`);
          formData.append(`cam${i + 1}`, blob, `cam${i + 1}.jpg`);
          snapshots.push(canvas.toDataURL("image/jpeg", 0.85));
          capturedCount++;
        } else {
          console.log(`[detection] cam${i + 1}: no video stream, sending placeholder`);
          formData.append(`cam${i + 1}`, createPlaceholderBlob(), `cam${i + 1}.jpg`);
          snapshots.push(null);
        }

        const cal = slots[i].calibration;
        if (cal?.matrix) {
          formData.append(`calibration${i + 1}`, JSON.stringify(cal.matrix));
        }
      }

      if (capturedCount === 0) {
        toast.error("No cameras are producing video. Check that cameras are connected and streams are active.");
        return;
      }
      console.log(`[detection] Sending ${capturedCount} real camera frames to /api/detection`);

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

      const result = await res.json();

      // Store full detection results for camera overlay
      setLastDetectionResult({
        cameras: result.cameras ?? [],
        chosenCamId: result.chosen_cam_id ?? null,
        snapshots,
      });

      const darts: DetectedDartOut[] = result.darts ?? [];

      if (darts.length === 0) {
        // Check if ANY camera detected raw darts (even without calibration)
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

      const scoredDarts = darts.filter((d: DetectedDartOut) => d.score_value != null);
      if (scoredDarts.length === 0) {
        toast.warning(
          `Detected ${darts.length} dart(s) but could not score them — check calibration.`,
        );
        return;
      }

      // Add all detected darts (up to 3 - currentDarts.length remaining slots)
      const slotsRemaining = 3 - currentDarts.length;
      const dartsToAdd = scoredDarts.slice(0, slotsRemaining);

      const newDarts: DartThrow[] = [];
      const newHits: DartBoardHit[] = [];

      for (const dart of dartsToAdd) {
        const hitPt = segmentHitPoint(
          dart.segment_id ?? "miss",
          dart.board_x,
          dart.board_y,
        );
        newDarts.push({ value: dart.score_value!, label: dart.score_label ?? "?" });
        newHits.push({
          x: hitPt.x,
          y: hitPt.y,
          segmentId: dart.segment_id ?? "miss",
          value: dart.score_value!,
          label: dart.score_label ?? "?",
        });
      }

      // Batch update state
      const allDarts = [...currentDarts, ...newDarts];
      setCurrentDarts(allDarts);
      setBoardHits((prev) => [...prev, ...newHits]);

      // Commentary for the last dart added
      if (newDarts.length > 0) {
        const lastDart = newDarts[newDarts.length - 1];
        if (allDarts.length >= 3) {
          const total = allDarts.reduce((sum, d) => sum + d.value, 0);
          setCommentary(getRoundEndComment(total));
          if (total > top3Threshold || leaderboard.length < 3) {
            setShowNameInput(true);
          }
        } else {
          setCommentary(getCommentary(lastDart, allDarts.length - 1, allDarts));
        }
        setCommentaryKey((k) => k + 1);
      }

      const totalDetected = scoredDarts.length;
      const labels = dartsToAdd.map((d: DetectedDartOut) => d.score_label).join(", ");
      toast.success(
        `Detected ${totalDetected} dart${totalDetected !== 1 ? "s" : ""}: ${labels} (Cam ${result.chosen_cam_id})`,
      );
    } catch (err) {
      console.error("[detection] Error:", err);
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("Detection timed out. The first run may be slow while the model loads — try again.");
      } else {
        toast.error(
          "Detection failed: " +
            (err instanceof Error ? err.message : "Unknown error"),
        );
      }
    } finally {
      clearTimeout(safetyTimer);
      setDetecting(false);
    }
  }, [roundComplete, detecting, hasAnyCameras, hasAnyCalibration, slots, currentDarts, top3Threshold, leaderboard.length]);

  const handleSaveRound = useCallback(() => {
    if (!playerName.trim()) return;
    const total = currentDarts.reduce((sum, d) => sum + d.value, 0);
    setLeaderboard((prev) =>
      [...prev, { name: playerName.trim(), score: total }]
        .sort((a, b) => b.score - a.score),
    );
    setCurrentDarts([]);
    setBoardHits([]);
    setPlayerName("");
    setShowNameInput(false);
    setCommentary("Step up to the oche...");
    setCommentaryKey((k) => k + 1);
    setLastDetectionResult(null);
  }, [currentDarts, playerName]);

  const handleReset = useCallback(() => {
    setCurrentDarts([]);
    setBoardHits([]);
    setPlayerName("");
    setShowNameInput(false);
    setCommentary("Step up to the oche...");
    setCommentaryKey((k) => k + 1);
    setLastDetectionResult(null);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8 gap-6 relative">
      {/* Settings toggles — fixed top right */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1">
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
      </div>

      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Data Intelligence Darts
        </h1>
        <p className="text-xs text-muted-foreground mt-1 tracking-wide">
          {manualClickEnabled ? "Click the board to throw" : "Waiting for auto-detection..."}
        </p>
      </div>

      {/* Score display */}
      <ScoreDisplay darts={currentDarts} />

      {/* Commentary */}
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

      {/* Dartboard */}
      <DartBoard onScore={handleScore} disabled={roundComplete || !manualClickEnabled} hits={boardHits} />

      {/* Detection button + camera strip */}
      <div className="flex flex-col items-center gap-3 w-full max-w-lg">
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
        {hasAnyCameras && (
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

        {!hasAnyCameras && (
          <p className="text-xs text-muted-foreground">
            No cameras assigned.{" "}
            <Link to="/settings" className="underline hover:text-foreground">
              Configure cameras
            </Link>{" "}
            to use detection.
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
            Score too low for top 3 — try again
          </button>
        )}
      </div>

      {/* Leaderboard */}
      <Leaderboard entries={leaderboard} />

      {/* Camera detection overlay dialog */}
      {overlayCamera !== null && lastDetectionResult && (
        <CameraDetectionDialog
          camId={overlayCamera}
          imageDataUrl={lastDetectionResult.snapshots[overlayCamera - 1] ?? null}
          camResult={lastDetectionResult.cameras.find((c) => c.cam_id === overlayCamera)}
          isChosen={lastDetectionResult.chosenCamId === overlayCamera}
          onClose={() => setOverlayCamera(null)}
        />
      )}
    </div>
  );
}
