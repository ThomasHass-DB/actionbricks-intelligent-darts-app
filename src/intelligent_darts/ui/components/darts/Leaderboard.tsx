import { Trophy } from "lucide-react";

export interface LeaderboardEntry {
  name: string;
  score: number;
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

const RANK_COLORS = [
  "text-yellow-400", // 1st
  "text-slate-300",  // 2nd
  "text-amber-600",  // 3rd
];

export function Leaderboard({ entries }: LeaderboardProps) {
  const sorted = [...entries]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (sorted.length === 0) return null;

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="flex items-center justify-center gap-2 mb-3">
        <Trophy className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Leaderboard
        </h3>
      </div>

      <div className="flex flex-col gap-1.5">
        {sorted.map((entry, i) => (
          <div
            key={`${entry.name}-${entry.score}-${i}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-2.5"
          >
            <span
              className={`text-sm font-bold w-5 text-center ${RANK_COLORS[i] ?? "text-muted-foreground"}`}
            >
              {i + 1}
            </span>
            <span className="flex-1 text-sm font-medium text-foreground truncate">
              {entry.name}
            </span>
            <span className="text-sm font-semibold text-muted-foreground tabular-nums">
              {entry.score} pts
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
