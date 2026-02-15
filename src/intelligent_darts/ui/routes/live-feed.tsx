import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Video, Aperture, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getCalibration, getCameraSettings, CameraMode } from "@/lib/api";
import type { CameraSettingsOut } from "@/lib/api";
import { KinesisCameraFeed } from "@/components/kinesis/KinesisCameraFeed";

export const Route = createFileRoute("/live-feed")({
  component: LiveFeed,
});

// ── Types ───────────────────────────────────────────────────────────────────

interface CameraSlot {
  deviceId: string;
  calibration: unknown;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a canvas to a JPEG Blob synchronously via toDataURL. */
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

/** Create a tiny 1x1 grey JPEG placeholder. */
function createPlaceholderBlob(): Blob {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 1, 1);
  return canvasToJpegBlob(c, 0.5);
}

// ── Camera Feed ─────────────────────────────────────────────────────────────

function CameraFeed({
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
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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
      <div className="w-full h-full flex flex-col items-center justify-center bg-muted/30 gap-2">
        <Video className="w-6 h-6 text-muted-foreground/40" />
        <span className="text-xs text-muted-foreground/50">
          No camera assigned
        </span>
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
          <Loader2 className="w-5 h-5 text-white/60 animate-spin" />
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

function LiveFeed() {
  const [slots, setSlots] = useState<CameraSlot[]>(loadSlots);

  // Camera mode (loaded from backend)
  const [cameraSettings, setCameraSettings] = useState<CameraSettingsOut | null>(null);
  const cameraMode = cameraSettings?.mode ?? CameraMode.local;

  useEffect(() => {
    getCameraSettings()
      .then(({ data }) => setCameraSettings(data))
      .catch(() => { /* backend unavailable, default to local */ });
  }, []);

  // Load calibrations from backend (restores after browser clears / device changes)
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
            if (local?.calibration) return local;
            if (s.matrix && s.matrix.length > 0) {
              return {
                deviceId: s.device_id || local?.deviceId || "",
                calibration: {
                  points: (s.points ?? []).map((p) => ({ x: p.x, y: p.y })),
                  matrix: s.matrix,
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
      .catch(() => { /* backend unavailable */ });
  }, []);
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const videoRef3 = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef([videoRef1, videoRef2, videoRef3]);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    setCapturing(true);

    // Safety timeout: force-reset after 15 seconds no matter what
    const safetyTimer = setTimeout(() => {
      setCapturing(false);
      toast.error("Capture timed out. Please try again.");
    }, 15_000);

    try {
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

      const formData = new FormData();
      formData.append("timestamp", timestamp);

      // Snapshot each camera (synchronous — no toBlob callbacks)
      let capturedCount = 0;
      for (let i = 0; i < NUM_CAMERAS; i++) {
        const video = videoRefs.current[i].current;
        if (video && video.videoWidth > 0 && video.srcObject) {
          // Active camera — grab frame (cap at 1280px wide to keep upload small)
          const scale = Math.min(1, 1280 / video.videoWidth);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = canvasToJpegBlob(canvas, 0.85);
          console.log(`[capture] cam${i + 1}: ${canvas.width}x${canvas.height}, blob=${blob.size} bytes`);
          formData.append(`cam${i + 1}`, blob, `cam${i + 1}.jpg`);
          capturedCount++;
        } else {
          // No stream — send tiny placeholder (endpoint requires 3 files)
          const blob = createPlaceholderBlob();
          formData.append(`cam${i + 1}`, blob, `cam${i + 1}.jpg`);
        }
      }

      if (capturedCount === 0) {
        toast.error(
          "No cameras are producing video. Check your camera connections.",
        );
        return;
      }

      console.log("[capture] Uploading to /api/raw-captures …");
      // Use raw fetch with abort timeout instead of generated client
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch("/api/raw-captures", {
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
        console.log("[capture] Upload complete:", result.capture_id);
        toast.success(
          `Captured throw: ${result.capture_id} (${capturedCount} camera${capturedCount > 1 ? "s" : ""})`,
        );
      } catch (fetchErr) {
        clearTimeout(fetchTimer);
        throw fetchErr;
      }
    } catch (err) {
      console.error("[capture] Error:", err);
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("Upload timed out (>10s). Are the cameras sending very large frames?");
      } else {
        toast.error(
          "Capture failed: " +
            (err instanceof Error ? err.message : "Unknown error"),
        );
      }
    } finally {
      clearTimeout(safetyTimer);
      setCapturing(false);
    }
  }, []);

  const hasAnyCameras =
    cameraMode === CameraMode.kinesis
      ? (cameraSettings?.channels ?? []).some((ch) => ch.channel_name?.trim())
      : slots.some((s) => s.deviceId);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            to="/labeling"
            className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back to labeling"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Live Feed
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              View all cameras and capture throws for labeling
            </p>
          </div>
        </div>

        {/* Camera grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {slots.map((slot, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10 text-primary text-xs font-bold">
                  {idx + 1}
                </div>
                <span className="text-xs font-medium text-foreground">
                  Camera {idx + 1}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      (cameraMode === CameraMode.kinesis
                        ? cameraSettings?.channels?.[idx]?.channel_name?.trim()
                        : slot.deviceId)
                        ? "bg-emerald-400"
                        : "bg-muted-foreground/30"
                    }`}
                  />
                </div>
              </div>
              <div className="aspect-video">
                {cameraMode === CameraMode.kinesis ? (
                  <KinesisCameraFeed
                    channelName={cameraSettings?.channels?.[idx]?.channel_name ?? ""}
                    region={cameraSettings?.region ?? "us-east-1"}
                    videoRef={videoRefs.current[idx]}
                  />
                ) : (
                  <CameraFeed
                    deviceId={slot.deviceId}
                    videoRef={videoRefs.current[idx]}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Capture button */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleCapture}
            disabled={capturing || !hasAnyCameras}
            className="flex items-center gap-2 h-12 px-8 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            {capturing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Capturing…
              </>
            ) : (
              <>
                <Aperture className="w-5 h-5" />
                Capture Throw
              </>
            )}
          </button>
          {!hasAnyCameras && (
            <p className="text-xs text-muted-foreground">
              <Camera className="w-3 h-3 inline mr-1" />
              No cameras assigned.{" "}
              <Link to="/settings" className="underline hover:text-foreground">
                Configure cameras
              </Link>{" "}
              first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
