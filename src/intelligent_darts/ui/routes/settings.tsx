import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Camera,
  Video,
  CircleDot,
  ChevronDown,
  Radio,
  Monitor,
  Wifi,
  KeyRound,
  Globe,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { CalibrationView } from "@/components/settings/CalibrationView";
import { KinesisCameraFeed } from "@/components/kinesis/KinesisCameraFeed";
import type { Point, Matrix3x3 } from "@/lib/homography";
import {
  useGetCameraSettings,
  useUpdateCameraSettings,
  CameraMode,
  type KinesisChannelConfig,
  getCalibration,
  saveCalibration,
  type CalibrationSlotIn,
} from "@/lib/api";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

// ── Types ───────────────────────────────────────────────────────────────────

interface CameraDevice {
  deviceId: string;
  label: string;
}

interface CalibrationEntry {
  points: Point[];
  matrix: Matrix3x3;
}

interface CameraSlot {
  /** Assigned device ID (empty string = unassigned) */
  deviceId: string;
  /** Calibration data (null = not calibrated) */
  calibration: CalibrationEntry | null;
}

const NUM_CAMERAS = 3;
const STORAGE_KEY = "darts_camera_slots";

function emptySlots(): CameraSlot[] {
  return Array.from({ length: NUM_CAMERAS }, () => ({
    deviceId: "",
    calibration: null,
  }));
}

function loadSlots(): CameraSlot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CameraSlot[];
      // Ensure we always have exactly NUM_CAMERAS slots
      while (parsed.length < NUM_CAMERAS)
        parsed.push({ deviceId: "", calibration: null });
      return parsed.slice(0, NUM_CAMERAS);
    }
  } catch {
    /* ignore */
  }
  return emptySlots();
}

function saveSlots(slots: CameraSlot[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    /* quota exceeded */
  }
  // Also persist to backend (fire-and-forget)
  syncCalibrationToBackend(slots);
}

/** Push calibration data to the backend so it survives browser clears / device changes. */
function syncCalibrationToBackend(slots: CameraSlot[]) {
  const apiSlots: CalibrationSlotIn[] = slots.map((s) => ({
    device_id: s.deviceId,
    device_label: "",
    points: s.calibration?.points?.map((p: Point) => ({ x: p.x, y: p.y })) ?? [],
    matrix: s.calibration?.matrix ?? [],
  }));
  saveCalibration({ slots: apiSlots }).catch(() => {
    /* best-effort — don't block the UI */
  });
}

// ── AWS Regions ─────────────────────────────────────────────────────────────

const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-south-1",
  "ca-central-1",
  "sa-east-1",
];

// ── Camera preview ──────────────────────────────────────────────────────────

function CameraPreview({
  deviceId,
  active,
}: {
  deviceId: string;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active || !deviceId) return;
    let cancelled = false;

    (async () => {
      await new Promise((r) => setTimeout(r, 150));
      if (cancelled) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        /* camera busy or denied */
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [deviceId, active]);

  if (!deviceId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted/30">
        <Video className="w-5 h-5 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover"
    />
  );
}

// ── Mode toggle button ──────────────────────────────────────────────────────

function ModeToggle({
  mode,
  onChange,
}: {
  mode: CameraMode;
  onChange: (mode: CameraMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
      <button
        onClick={() => onChange(CameraMode.local)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          mode === CameraMode.local
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Monitor className="w-3.5 h-3.5" />
        Local Cameras
      </button>
      <button
        onClick={() => onChange(CameraMode.kinesis)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          mode === CameraMode.kinesis
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Wifi className="w-3.5 h-3.5" />
        Kinesis Streams
      </button>
    </div>
  );
}

// ── Kinesis settings section ────────────────────────────────────────────────

function KinesisSettings({
  serviceCredentialName,
  region,
  channels,
  onServiceCredentialChange,
  onRegionChange,
  onChannelNameChange,
}: {
  serviceCredentialName: string;
  region: string;
  channels: KinesisChannelConfig[];
  onServiceCredentialChange: (name: string) => void;
  onRegionChange: (region: string) => void;
  onChannelNameChange: (idx: number, channelName: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Service Credential */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          Connection
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Service Credential Name
            </label>
            <input
              type="text"
              value={serviceCredentialName}
              onChange={(e) => onServiceCredentialChange(e.target.value)}
              placeholder="e.g. kinesis-video-credential"
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              AWS Region
            </label>
            <div className="relative">
              <select
                value={region}
                onChange={(e) => onRegionChange(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer"
              >
                {AWS_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted-foreground">
                <ChevronDown className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Signaling channel names per camera */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Play className="w-3.5 h-3.5" />
          Signaling Channels
        </div>

        <p className="text-xs text-muted-foreground">
          Specify the Kinesis Video Streams WebRTC signaling channel name for each camera.
        </p>

        <div className="space-y-2">
          {channels.map((ch, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold flex-shrink-0">
                {idx + 1}
              </div>
              <input
                type="text"
                value={ch.channel_name ?? ""}
                onChange={(e) => onChannelNameChange(idx, e.target.value)}
                placeholder={`Camera ${idx + 1} channel name`}
                className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {ch.channel_name ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-muted-foreground">
                    Configured
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                  <span className="text-xs text-muted-foreground">
                    Not set
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

function Settings() {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [slots, setSlots] = useState<CameraSlot[]>(loadSlots);
  const [calibrationLoaded, setCalibrationLoaded] = useState(false);

  // Camera mode & Kinesis config
  const [mode, setMode] = useState<CameraMode>(CameraMode.local);
  const [serviceCredentialName, setServiceCredentialName] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [channels, setChannels] = useState<KinesisChannelConfig[]>(
    Array.from({ length: NUM_CAMERAS }, () => ({ channel_name: "" })),
  );
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Which slot index is being calibrated (null = none)
  const [calibratingSlot, setCalibratingSlot] = useState<number | null>(null);

  // ── Load calibration from backend ─────────────────────────────────────
  useEffect(() => {
    if (calibrationLoaded) return;
    getCalibration()
      .then(({ data: calData }) => {
        const backendSlots = calData?.slots;
        if (backendSlots && backendSlots.length > 0) {
          const hasCalibration = backendSlots.some(
            (s) => s.matrix && s.matrix.length > 0,
          );
          if (hasCalibration) {
            const merged: CameraSlot[] = backendSlots.map((s, i) => {
              const local = slots[i];
              if (local?.calibration?.matrix?.length) return local;
              if (s.matrix && s.matrix.length > 0) {
                return {
                  deviceId: s.device_id || local?.deviceId || "",
                  calibration: {
                    points: (s.points ?? []).map((p) => ({ x: p.x, y: p.y })),
                    matrix: s.matrix as Matrix3x3,
                  },
                };
              }
              return local || { deviceId: "", calibration: null };
            });
            while (merged.length < NUM_CAMERAS)
              merged.push({ deviceId: "", calibration: null });
            setSlots(merged.slice(0, NUM_CAMERAS));
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.slice(0, NUM_CAMERAS)));
            } catch { /* ignore */ }
          }
        }
      })
      .catch(() => { /* backend unavailable, use localStorage */ })
      .finally(() => setCalibrationLoaded(true));
  }, [calibrationLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load settings from backend ─────────────────────────────────────────
  const { data: settingsData } = useGetCameraSettings({
    query: { retry: false },
  });

  const updateMutation = useUpdateCameraSettings();

  // Sync backend settings to local state (once on load)
  useEffect(() => {
    if (settingsData?.data && !settingsLoaded) {
      const s = settingsData.data;
      setMode(s.mode);
      setServiceCredentialName(s.service_credential_name);
      setRegion(s.region);
      if (s.channels.length > 0) {
        // Ensure we always have NUM_CAMERAS channels
        const padded = [...s.channels];
        while (padded.length < NUM_CAMERAS)
          padded.push({ channel_name: "" });
        setChannels(padded.slice(0, NUM_CAMERAS));
      }
      setSettingsLoaded(true);
    }
  }, [settingsData, settingsLoaded]);

  // ── Save settings to backend (debounced) ──────────────────────────────
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveSettings = useCallback(
    (
      newMode: CameraMode,
      newCredName: string,
      newRegion: string,
      newChannels: KinesisChannelConfig[],
    ) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateMutation.mutate(
          {
            mode: newMode,
            service_credential_name: newCredName,
            region: newRegion,
            channels: newChannels,
          },
          {
            onError: () => {
              toast.error("Failed to save settings");
            },
          },
        );
      }, 500);
    },
    [updateMutation],
  );

  // ── Mode change ────────────────────────────────────────────────────────
  const handleModeChange = useCallback(
    (newMode: CameraMode) => {
      setMode(newMode);
      saveSettings(newMode, serviceCredentialName, region, channels);
    },
    [saveSettings, serviceCredentialName, region, channels],
  );

  // ── Kinesis field changes ──────────────────────────────────────────────
  const handleServiceCredentialChange = useCallback(
    (name: string) => {
      setServiceCredentialName(name);
      saveSettings(mode, name, region, channels);
    },
    [saveSettings, mode, region, channels],
  );

  const handleRegionChange = useCallback(
    (newRegion: string) => {
      setRegion(newRegion);
      saveSettings(mode, serviceCredentialName, newRegion, channels);
    },
    [saveSettings, mode, serviceCredentialName, channels],
  );

  const handleChannelNameChange = useCallback(
    (idx: number, channelName: string) => {
      setChannels((prev) => {
        const next = [...prev];
        next[idx] = { channel_name: channelName };
        saveSettings(mode, serviceCredentialName, region, next);
        return next;
      });
    },
    [saveSettings, mode, serviceCredentialName, region],
  );

  // ── Enumerate devices (only when in local mode) ─────────────────────────

  useEffect(() => {
    if (mode !== CameraMode.local) return;
    let cancelled = false;

    (async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach((t) => t.stop());
        if (cancelled) return;
        setPermissionGranted(true);

        const all = await navigator.mediaDevices.enumerateDevices();
        const cams = all
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `USB Camera ${i + 1}`,
          }));

        if (!cancelled) setDevices(cams);
      } catch {
        /* permission denied or no cameras */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  // ── Slot helpers ──────────────────────────────────────────────────────

  const updateSlot = useCallback(
    (idx: number, patch: Partial<CameraSlot>) => {
      setSlots((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        saveSlots(next);
        return next;
      });
    },
    [],
  );

  const handleDeviceChange = useCallback(
    (idx: number, deviceId: string) => {
      // Clear calibration when device changes
      updateSlot(idx, { deviceId, calibration: null });
    },
    [updateSlot],
  );

  // ── Calibration ───────────────────────────────────────────────────────

  const handleStartCalibration = useCallback((slotIdx: number) => {
    setCalibratingSlot(slotIdx);
  }, []);

  const handleCalibrationComplete = useCallback(
    (points: Point[], matrix: Matrix3x3) => {
      if (calibratingSlot === null) return;
      updateSlot(calibratingSlot, { calibration: { points, matrix } });
      setCalibratingSlot(null);
    },
    [calibratingSlot, updateSlot],
  );

  // ── Kinesis video refs (for preview + calibration + snapshot) ─────────
  const kinesisVideoRef1 = useRef<HTMLVideoElement>(null);
  const kinesisVideoRef2 = useRef<HTMLVideoElement>(null);
  const kinesisVideoRef3 = useRef<HTMLVideoElement>(null);
  const kinesisVideoRefs = useRef([kinesisVideoRef1, kinesisVideoRef2, kinesisVideoRef3]);

  // ── Full-screen calibration overlay ───────────────────────────────────

  if (calibratingSlot !== null) {
    if (mode === CameraMode.kinesis) {
      // Kinesis mode — CalibrationView establishes its own WebRTC connection
      const channelName = channels[calibratingSlot]?.channel_name ?? "";
      return (
        <CalibrationView
          kinesisChannelName={channelName}
          kinesisRegion={region}
          onComplete={handleCalibrationComplete}
          onCancel={() => setCalibratingSlot(null)}
        />
      );
    }
    // Local mode — pass deviceId as before
    const deviceId = slots[calibratingSlot].deviceId;
    return (
      <CalibrationView
        cameraDeviceId={deviceId}
        onComplete={handleCalibrationComplete}
        onCancel={() => setCalibratingSlot(null)}
      />
    );
  }

  // ── Derived ───────────────────────────────────────────────────────────

  const calibratedCount = slots.filter((s) => s.calibration).length;
  const assignedIds = new Set(slots.map((s) => s.deviceId).filter(Boolean));
  const configuredChannels = channels.filter(
    (ch) => ch.channel_name && ch.channel_name.trim(),
  ).length;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            to="/"
            className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back to game"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
        </div>

        {/* ── Camera Source Mode ──────────────────────────────────────── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Camera Source
              </h2>
            </div>
            <ModeToggle mode={mode} onChange={handleModeChange} />
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {mode === CameraMode.local
              ? "Use locally connected USB cameras. Select a device for each slot and calibrate."
              : "Use Amazon Kinesis Video Streams WebRTC. Provide your Databricks service credential, AWS region, and signaling channel names."}
          </p>
        </section>

        {/* ── Kinesis Settings (when kinesis mode) ────────────────────── */}
        {mode === CameraMode.kinesis && (
          <section className="mb-6">
            <KinesisSettings
              serviceCredentialName={serviceCredentialName}
              region={region}
              channels={channels}
              onServiceCredentialChange={handleServiceCredentialChange}
              onRegionChange={handleRegionChange}
              onChannelNameChange={handleChannelNameChange}
            />
          </section>
        )}

        {/* ── Kinesis Camera Slots (when kinesis mode) ──────────────────── */}
        {mode === CameraMode.kinesis && configuredChannels > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Camera Feeds
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {calibratedCount} / {NUM_CAMERAS} calibrated
              </span>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Live WebRTC feeds from your Kinesis signaling channels. Calibrate each to compute the perspective transform.
            </p>

            <div className="space-y-3">
              {channels.map((ch, idx) => {
                const hasChannel = !!(ch.channel_name && ch.channel_name.trim());
                const isCalibrated = !!slots[idx]?.calibration;

                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-border bg-card overflow-hidden"
                  >
                    {/* Slot header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-medium text-foreground whitespace-nowrap">
                        Camera {idx + 1}
                      </span>
                      <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                        {hasChannel ? ch.channel_name : "Not configured"}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isCalibrated
                              ? "bg-emerald-400"
                              : hasChannel
                                ? "bg-amber-400 animate-pulse"
                                : "bg-muted-foreground/30"
                          }`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {isCalibrated
                            ? "Calibrated"
                            : hasChannel
                              ? "Pending"
                              : "No channel"}
                        </span>
                      </div>
                    </div>

                    {/* Preview + actions */}
                    {hasChannel && (
                      <div className="flex gap-0">
                        <div className="w-44 h-24 bg-black flex-shrink-0">
                          <KinesisCameraFeed
                            channelName={ch.channel_name!}
                            region={region}
                            videoRef={kinesisVideoRefs.current[idx]}
                          />
                        </div>

                        <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                          {isCalibrated && slots[idx]?.calibration ? (
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground font-mono tabular-nums">
                              {["20/1", "6/10", "3/19", "11/14"].map(
                                (label, i) => {
                                  const p = slots[idx].calibration!.points[i];
                                  return (
                                    <span key={label}>
                                      P{i + 1} ({label}):{" "}
                                      {Math.round(p.x)},{Math.round(p.y)}
                                    </span>
                                  );
                                },
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Channel connected — calibrate to compute the perspective transform.
                            </p>
                          )}

                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => handleStartCalibration(idx)}
                              className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                            >
                              {isCalibrated ? (
                                <>
                                  <CircleDot className="w-3 h-3" />
                                  Recalibrate
                                </>
                              ) : (
                                "Calibrate"
                              )}
                            </button>
                            {isCalibrated && (
                              <button
                                onClick={() =>
                                  updateSlot(idx, { calibration: null })
                                }
                                className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Local Camera Slots (when local mode) ────────────────────── */}
        {mode === CameraMode.local && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cameras
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {calibratedCount} / {NUM_CAMERAS} calibrated
              </span>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Assign a device to each camera slot, then calibrate by picking 4
              double-ring corners on the live feed.
            </p>

            {!permissionGranted && (
              <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-3">
                <Video className="w-6 h-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Camera permission required — reload and allow access
                </span>
              </div>
            )}

            {permissionGranted && (
              <div className="space-y-3">
                {slots.map((slot, idx) => {
                  const isCalibrated = !!slot.calibration;
                  const hasDevice = !!slot.deviceId;

                  return (
                    <div
                      key={idx}
                      className="rounded-xl border border-border bg-card overflow-hidden"
                    >
                      {/* Slot header with source selector */}
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold">
                          {idx + 1}
                        </div>
                        <span className="text-sm font-medium text-foreground whitespace-nowrap">
                          Camera {idx + 1}
                        </span>

                        {/* Device selector */}
                        <div className="relative flex-1 min-w-0">
                          <select
                            value={slot.deviceId}
                            onChange={(e) =>
                              handleDeviceChange(idx, e.target.value)
                            }
                            className="w-full h-8 rounded-lg border border-border bg-background pl-3 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer truncate"
                          >
                            <option value="">Select device…</option>
                            {devices.map((dev) => {
                              const usedByOther =
                                assignedIds.has(dev.deviceId) &&
                                slot.deviceId !== dev.deviceId;
                              return (
                                <option
                                  key={dev.deviceId}
                                  value={dev.deviceId}
                                  disabled={usedByOther}
                                >
                                  {dev.label}
                                  {usedByOther ? " (in use)" : ""}
                                </option>
                              );
                            })}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-muted-foreground">
                            <ChevronDown className="w-3 h-3" />
                          </div>
                        </div>

                        {/* Status badge */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              isCalibrated
                                ? "bg-emerald-400"
                                : hasDevice
                                  ? "bg-amber-400 animate-pulse"
                                  : "bg-muted-foreground/30"
                            }`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {isCalibrated
                              ? "Calibrated"
                              : hasDevice
                                ? "Pending"
                                : "No device"}
                          </span>
                        </div>
                      </div>

                      {/* Preview + actions (only when device assigned) */}
                      {hasDevice && (
                        <div className="flex gap-0">
                          <div className="w-44 h-24 bg-black flex-shrink-0">
                            <CameraPreview
                              deviceId={slot.deviceId}
                              active={calibratingSlot === null}
                            />
                          </div>

                          <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                            {isCalibrated && slot.calibration ? (
                              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground font-mono tabular-nums">
                                {["20/1", "6/10", "3/19", "11/14"].map(
                                  (label, i) => {
                                    const p = slot.calibration!.points[i];
                                    return (
                                      <span key={label}>
                                        P{i + 1} ({label}):{" "}
                                        {Math.round(p.x)},{Math.round(p.y)}
                                      </span>
                                    );
                                  },
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Device assigned — calibrate to compute the
                                perspective transform.
                              </p>
                            )}

                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => handleStartCalibration(idx)}
                                className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                              >
                                {isCalibrated ? (
                                  <>
                                    <CircleDot className="w-3 h-3" />
                                    Recalibrate
                                  </>
                                ) : (
                                  "Calibrate"
                                )}
                              </button>
                              {isCalibrated && (
                                <button
                                  onClick={() =>
                                    updateSlot(idx, { calibration: null })
                                  }
                                  className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Status summary ──────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3.5 h-3.5" />
            <span>
              Mode:{" "}
              <span className="font-medium text-foreground">
                {mode === CameraMode.local ? "Local Cameras" : "Kinesis WebRTC"}
              </span>
            </span>
            <span className="text-border">•</span>
            {mode === CameraMode.local ? (
              <span>
                {calibratedCount} / {NUM_CAMERAS} calibrated
              </span>
            ) : (
              <span>
                {configuredChannels} / {NUM_CAMERAS} channels configured
                {serviceCredentialName && (
                  <>
                    <span className="text-border"> • </span>
                    Credential: {serviceCredentialName}
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
