import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Camera,
  Database,
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorBoundary } from "react-error-boundary";
import { CaptureGallery } from "@/components/labeling/CaptureGallery";
import { useGetDatasetStats } from "@/lib/api";

export const Route = createFileRoute("/labeling")({
  component: LabelingPage,
});

// ── Dataset helpers ──────────────────────────────────────────────────────────

function DatasetStatsDisplay() {
  const { data } = useGetDatasetStats({ query: { retry: false } });
  const stats = data?.data;
  if (!stats) return null;

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>{stats.total_captures ?? 0} captures</span>
      <span className="text-border">•</span>
      <span>{stats.labeled_images ?? 0} labeled</span>
      <span className="text-border">•</span>
      <span>
        {stats.train_images ?? 0}T / {stats.val_images ?? 0}V
      </span>
    </div>
  );
}

function ExportDatasetButton() {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/dataset/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "darts_dataset.zip";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Dataset exported successfully");
    } catch {
      toast.error("Failed to export dataset");
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border bg-background text-foreground text-xs font-medium hover:bg-accent disabled:opacity-40 transition-colors"
    >
      {exporting ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Exporting…
        </>
      ) : (
        <>
          <Download className="w-3.5 h-3.5" />
          Export Dataset
        </>
      )}
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

function LabelingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            to="/"
            className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back to game"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Data Collection & Labeling
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Capture throws, label dart keypoints, and export for YOLOv8-Pose
              training
            </p>
          </div>
        </div>

        {/* Stats + Quick Actions */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dataset Overview
              </h2>
            </div>
            <DatasetStatsDisplay />
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/live-feed"
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              Open Live Feed
              <ExternalLink className="w-3 h-3 ml-0.5" />
            </Link>
            <ExportDatasetButton />
          </div>
        </section>

        {/* Gallery */}
        <section>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Captured Throws
            </div>
            <ErrorBoundary
              fallback={
                <p className="text-sm text-destructive py-4 text-center">
                  Failed to load captures. Please try refreshing the page.
                </p>
              }
            >
              <CaptureGallery />
            </ErrorBoundary>
          </div>
        </section>
      </div>
    </div>
  );
}
