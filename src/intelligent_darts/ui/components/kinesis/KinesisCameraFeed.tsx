/**
 * KinesisCameraFeed — renders a Kinesis WebRTC signaling channel as a live
 * video feed.  Uses the shared connection pool so sessions survive page
 * navigations instead of reconnecting every time.
 */

import { useEffect, useRef, useState } from "react";
import { Video, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { acquire, release } from "@/lib/kinesis-pool";

interface KinesisCameraFeedProps {
  /** Signaling channel name (empty = unassigned). */
  channelName: string;
  /** AWS region (from camera settings). */
  region: string;
  /** Ref to the underlying <video> for snapshotting. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function KinesisCameraFeed({
  channelName,
  region,
  videoRef,
}: KinesisCameraFeedProps) {
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "streaming" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const activeChannelRef = useRef<string | null>(null);

  // Debounced channel name — only connect after the user stops typing for 1.5s
  const [debouncedChannel, setDebouncedChannel] = useState("");
  useEffect(() => {
    if (!channelName) {
      setDebouncedChannel("");
      return;
    }
    const timer = setTimeout(() => setDebouncedChannel(channelName), 1500);
    return () => clearTimeout(timer);
  }, [channelName]);

  useEffect(() => {
    if (!debouncedChannel) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("connecting");
    setErrorMsg(null);
    activeChannelRef.current = debouncedChannel;

    (async () => {
      try {
        // Acquire stream from the shared pool (reuses existing session)
        const stream = await acquire(debouncedChannel);

        if (cancelled) {
          release(debouncedChannel);
          return;
        }

        // Attach stream to video element
        const vid = videoRef.current;
        if (vid) {
          vid.srcObject = stream;
          setStatus("connected");

          // Wait for actual frames to render
          const onPlaying = () => {
            if (!cancelled) setStatus("streaming");
            vid.removeEventListener("playing", onPlaying);
          };
          vid.addEventListener("playing", onPlaying);

          // Fallback: poll for video frames
          const poll = setInterval(() => {
            if (cancelled) {
              clearInterval(poll);
              return;
            }
            if (vid.videoWidth > 0 && vid.readyState >= 2) {
              setStatus("streaming");
              clearInterval(poll);
              vid.removeEventListener("playing", onPlaying);
            }
          }, 500);

          setTimeout(() => clearInterval(poll), 60_000);
        }
      } catch (err) {
        if (cancelled) return;
        console.error(`[KinesisCameraFeed] ${debouncedChannel}:`, err);
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Connection failed");
      }
    })();

    return () => {
      cancelled = true;
      // Release our reference — pool keeps the session alive for the grace period
      if (activeChannelRef.current) {
        release(activeChannelRef.current);
        activeChannelRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [debouncedChannel, region, videoRef, retryCount]);

  if (!channelName) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-muted/30 gap-2">
        <Video className="w-6 h-6 text-muted-foreground/40" />
        <span className="text-xs text-muted-foreground/50">
          No channel assigned
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
      {(status === "connecting" || status === "connected") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2">
          <Loader2 className="w-5 h-5 text-white/60 animate-spin" />
          <span className="text-xs text-white/50">
            {status === "connecting"
              ? `Connecting to ${channelName}...`
              : "Waiting for video frames..."}
          </span>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-2 px-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="text-xs text-red-300 text-center leading-tight">
            {errorMsg || "Connection failed"}
          </span>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="mt-1 flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
