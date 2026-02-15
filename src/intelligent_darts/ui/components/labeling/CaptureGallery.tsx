import { useState } from "react";
import { Image, Loader2, FolderOpen, Trash2, Check, Filter } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRawCaptures,
  useDeleteRawCapture,
  getDatasetStatsKey,
  listRawCapturesKey,
  type RawCaptureGroupOut,
} from "@/lib/api";
import { toast } from "sonner";
import { LabelerDialog } from "./LabelerDialog";

// ── Component ───────────────────────────────────────────────────────────────

export function CaptureGallery() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useListRawCaptures();
  const deleteMutation = useDeleteRawCapture();
  const [labelingCapture, setLabelingCapture] =
    useState<RawCaptureGroupOut | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showOnlyUnlabeled, setShowOnlyUnlabeled] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: listRawCapturesKey() });
    queryClient.invalidateQueries({ queryKey: getDatasetStatsKey() });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-destructive">
          Failed to load captures: {error.message}
        </p>
      </div>
    );
  }

  const allCaptures = data?.data?.captures ?? [];
  const captures = showOnlyUnlabeled
    ? allCaptures.filter((c) => (c.labeled_count ?? 0) < c.filenames.length)
    : allCaptures;

  const totalLabeled = allCaptures.filter(
    (c) => (c.labeled_count ?? 0) >= c.filenames.length,
  ).length;

  if (allCaptures.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8">
        <FolderOpen className="w-6 h-6 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No captures yet. Go to the Live Feed to capture throws.
        </p>
      </div>
    );
  }

  const handleDelete = (captureId: string) => {
    setDeletingId(captureId);
    deleteMutation.mutate(
      { params: { capture_id: captureId } },
      {
        onSuccess: () => {
          toast.success(`Deleted capture ${captureId}`);
          invalidateAll();
        },
        onError: () => {
          toast.error(`Failed to delete capture ${captureId}`);
        },
        onSettled: () => {
          setDeletingId(null);
        },
      },
    );
  };

  return (
    <>
      {/* Filter toolbar */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-muted-foreground">
          {totalLabeled} / {allCaptures.length} fully labeled
        </div>
        <button
          onClick={() => setShowOnlyUnlabeled((v) => !v)}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs transition-colors ${
            showOnlyUnlabeled
              ? "bg-primary/15 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Filter className="w-3 h-3" />
          {showOnlyUnlabeled ? "Showing unlabeled" : "Show unlabeled only"}
        </button>
      </div>

      {captures.length === 0 && showOnlyUnlabeled ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <Check className="w-6 h-6 text-emerald-400" />
          <p className="text-sm text-muted-foreground">
            All captures are labeled!
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {captures.map((capture) => (
            <CaptureRow
              key={capture.capture_id}
              capture={capture}
              onLabel={() => setLabelingCapture(capture)}
              onDelete={() => handleDelete(capture.capture_id)}
              deleting={deletingId === capture.capture_id}
            />
          ))}
        </div>
      )}

      {/* Labeler overlay */}
      {labelingCapture && (
        <LabelerDialog
          captureId={labelingCapture.capture_id}
          filenames={labelingCapture.filenames}
          onClose={() => setLabelingCapture(null)}
          onSaved={() => {
            invalidateAll();
          }}
        />
      )}
    </>
  );
}

// ── Capture row ─────────────────────────────────────────────────────────────

function CaptureRow({
  capture,
  onLabel,
  onDelete,
  deleting,
}: {
  capture: RawCaptureGroupOut;
  onLabel: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const displayTs = formatTimestamp(capture.timestamp);
  const labeledCount = capture.labeled_count ?? 0;
  const totalFiles = capture.filenames.length;
  const fullyLabeled = labeledCount >= totalFiles;
  const partiallyLabeled = labeledCount > 0 && !fullyLabeled;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-2 transition-colors ${
        fullyLabeled
          ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
          : partiallyLabeled
            ? "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
            : "border-border/50 bg-background/50 hover:bg-accent/30"
      }`}
    >
      {/* Thumbnails */}
      <div className="flex gap-1 flex-shrink-0">
        {capture.filenames.map((fn, i) => {
          const camMatch = fn.match(/_cam(\d+)\./);
          const camId = camMatch ? parseInt(camMatch[1], 10) : i + 1;
          return (
            <button
              key={fn}
              onClick={onLabel}
              className="w-16 h-12 rounded-md overflow-hidden border border-border/30 bg-black hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer"
            >
              <img
                src={`/api/raw-captures/${capture.capture_id}/cam/${camId}`}
                alt={`Camera ${camId}`}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </button>
          );
        })}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">
          {displayTs}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {totalFiles} camera{totalFiles > 1 ? "s" : ""}
          </span>
          {fullyLabeled && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
              <Check className="w-3 h-3" />
              Labeled
            </span>
          )}
          {partiallyLabeled && (
            <span className="text-[11px] text-amber-400 font-medium">
              {labeledCount}/{totalFiles} labeled
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={onLabel}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium transition-colors ${
            fullyLabeled
              ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          <Image className="w-3 h-3" />
          {fullyLabeled ? "Edit" : "Label"}
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
          title="Delete capture"
        >
          {deleting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  }
  return ts;
}
