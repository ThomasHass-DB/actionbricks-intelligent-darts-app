export interface DartThrow {
  value: number;
  label: string;
}

interface ScoreDisplayProps {
  darts: DartThrow[];
}

/** Minimal horizontal dart arrow icon */
function DartIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Tip */}
      <polygon points="32,12 26,10 26,14" fill="currentColor" opacity="0.9" />
      {/* Barrel */}
      <rect x="12" y="11" width="14" height="2" rx="0.5" fill="currentColor" opacity="0.7" />
      {/* Flights */}
      <polygon points="12,12 4,6 7,12" fill="currentColor" opacity="0.4" />
      <polygon points="12,12 4,18 7,12" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function ScoreDisplay({ darts }: ScoreDisplayProps) {
  const total = darts.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex items-stretch justify-center gap-3">
      {[0, 1, 2].map((i) => {
        const dart = darts[i];
        const isActive = i === darts.length;
        return (
          <div
            key={i}
            className={`
              flex flex-col items-center justify-center rounded-lg border px-5 min-w-[90px] h-[72px]
              transition-all duration-200
              ${isActive ? "border-primary/60 bg-primary/10" : "border-border bg-card/60"}
            `}
          >
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Dart {i + 1}
            </span>
            {dart ? (
              <span className="text-xl font-bold text-foreground tabular-nums leading-tight">
                {dart.label}
              </span>
            ) : (
              <DartIcon className="w-7 h-5 text-muted-foreground/40" />
            )}
            <span className="text-[10px] text-muted-foreground h-3.5">
              {dart ? `${dart.value} pts` : ""}
            </span>
          </div>
        );
      })}

      {/* Total */}
      <div className="flex flex-col items-center justify-center rounded-lg border border-primary/40 bg-primary/5 px-5 min-w-[90px] h-[72px]">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Total
        </span>
        <span className="text-xl font-bold text-primary tabular-nums leading-tight">
          {total}
        </span>
        <span className="h-3.5" />
      </div>
    </div>
  );
}
