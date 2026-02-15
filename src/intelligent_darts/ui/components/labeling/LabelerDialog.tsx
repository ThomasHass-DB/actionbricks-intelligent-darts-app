import { useState, useCallback } from "react";
import { X, Save, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { LabelCanvas, type DartAnnotation } from "./LabelCanvas";
import { useSaveYoloLabels, type SaveLabelsIn } from "@/lib/api";

// ── Props ───────────────────────────────────────────────────────────────────

interface LabelerDialogProps {
  captureId: string;
  /** Array of filenames for this capture group (cam1, cam2, cam3) */
  filenames: string[];
  onClose: () => void;
  onSaved?: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function LabelerDialog({
  captureId,
  filenames,
  onClose,
  onSaved,
}: LabelerDialogProps) {
  const [currentCamIdx, setCurrentCamIdx] = useState(0);
  // Per-camera dart annotations
  const [annotationsPerCam, setAnnotationsPerCam] = useState<
    Record<number, DartAnnotation[]>
  >({});
  const [saving, setSaving] = useState(false);

  const saveLabelsMutation = useSaveYoloLabels();

  const currentFilename = filenames[currentCamIdx] ?? "";
  // Extract cam number from filename: dart_<TS>_cam<N>.jpg
  const camMatch = currentFilename.match(/_cam(\d+)\./);
  const camId = camMatch ? parseInt(camMatch[1], 10) : currentCamIdx + 1;
  const imageUrl = `/api/raw-captures/${captureId}/cam/${camId}`;

  const handleDartsChange = useCallback(
    (darts: DartAnnotation[]) => {
      setAnnotationsPerCam((prev) => ({ ...prev, [currentCamIdx]: darts }));
    },
    [currentCamIdx],
  );

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    let savedCount = 0;
    let lastError: string | null = null;

    for (let i = 0; i < filenames.length; i++) {
      const darts = annotationsPerCam[i];
      if (!darts || darts.length === 0) continue;

      const filename = filenames[i];
      // We need image dimensions. Create a temporary Image to get naturalWidth/Height.
      const imgDims = await getImageDimensions(
        `/api/raw-captures/${captureId}/cam/${i + 1}`,
      );

      const body: SaveLabelsIn = {
        image_filename: filename,
        image_width: imgDims.width,
        image_height: imgDims.height,
        darts: darts.map((d) => ({
          tip: { x: d.tip.x, y: d.tip.y },
          tail: d.tail ? { x: d.tail.x, y: d.tail.y } : { x: 0, y: 0 },
          tail_visible: d.tail !== null,
        })),
      };

      try {
        await saveLabelsMutation.mutateAsync(body);
        savedCount++;
      } catch {
        lastError = `Failed to save labels for ${filename}`;
      }
    }

    setSaving(false);

    if (lastError) {
      toast.error(lastError);
    } else if (savedCount === 0) {
      toast.warning("No annotations to save. Label at least one dart first.");
    } else {
      toast.success(`Saved labels for ${savedCount} image${savedCount > 1 ? "s" : ""}`);
      onSaved?.();
      onClose();
    }
  }, [annotationsPerCam, filenames, captureId, saveLabelsMutation, onSaved, onClose]);

  const totalAnnotated = Object.values(annotationsPerCam).filter(
    (a) => a && a.length > 0,
  ).length;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Label Darts
            </h2>
            <span className="text-xs text-muted-foreground">
              Capture: {captureId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {totalAnnotated} / {filenames.length} cameras labeled
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Camera tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-border/50">
          <button
            onClick={() => setCurrentCamIdx((i) => Math.max(0, i - 1))}
            disabled={currentCamIdx === 0}
            className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {filenames.map((fn, i) => {
            const hasAnnotations =
              annotationsPerCam[i] && annotationsPerCam[i].length > 0;
            return (
              <button
                key={fn}
                onClick={() => setCurrentCamIdx(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  i === currentCamIdx
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                Camera {i + 1}
                {hasAnnotations && (
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}

          <button
            onClick={() =>
              setCurrentCamIdx((i) => Math.min(filenames.length - 1, i + 1))
            }
            disabled={currentCamIdx === filenames.length - 1}
            className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas area */}
        <div className="flex-1 px-5 py-3 min-h-0">
          <LabelCanvas
            key={`${captureId}-cam${currentCamIdx}`}
            imageUrl={imageUrl}
            initialDarts={annotationsPerCam[currentCamIdx] ?? []}
            onDartsChange={handleDartsChange}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            Click Tip (red) then Tail (blue) for each dart. Use &quot;No
            Tail&quot; if flight is out of frame. Switch cameras with tabs.
          </p>
          <button
            onClick={handleSaveAll}
            disabled={saving || totalAnnotated === 0}
            className="flex items-center gap-2 h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Labels
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getImageDimensions(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}
