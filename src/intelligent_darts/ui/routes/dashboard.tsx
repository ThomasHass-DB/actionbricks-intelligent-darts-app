import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Target, RotateCcw, Users, Hash, Star, Zap } from "lucide-react";
import { useGetLeaderboard } from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatsOut {
  total_players: number;
  total_rounds: number;
  avg_round_score: number;
  best_round_ever: number;
  top_segments: { segment: string; count: number }[];
  score_distribution: { bucket: string; count: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSegment(seg: string): string {
  if (seg === "inner-bull") return "D-Bull";
  if (seg === "outer-bull") return "Bull";
  if (seg.startsWith("t-")) return `T${seg.slice(2)}`;
  if (seg.startsWith("d-")) return `D${seg.slice(2)}`;
  return seg; // already a number for singles
}

const RANK_COLORS = ["text-yellow-400", "text-slate-300", "text-amber-600"];
const BAR_COLOR = "#6b97e8";      // matches dark theme --primary oklch(0.65 0.18 250)
const BAR_COLOR_ALT = "#3f4f63"; // muted slate

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-5 py-4 flex items-center gap-4">
      <div className="p-2 rounded-md bg-accent/40">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{payload[0].value} rounds</p>
    </div>
  );
}

function SegmentTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{payload[0].value} throws</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function Dashboard() {
  const { data: leaderboardRes, isLoading: lbLoading, refetch: refetchLb } = useGetLeaderboard();
  const entries = leaderboardRes?.data ?? [];

  const {
    data: statsRes,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery<StatsOut>({
    queryKey: ["/api/stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json() as Promise<StatsOut>;
    },
  });

  const isLoading = lbLoading || statsLoading;

  function handleRefresh() {
    void refetchLb();
    void refetchStats();
  }

  const segmentData = (statsRes?.top_segments ?? []).map((s) => ({
    ...s,
    label: formatSegment(s.segment),
  }));

  return (
    <div className="min-h-screen bg-background px-4 py-8 max-w-3xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <button
          onClick={handleRefresh}
          className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          title="Refresh"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Stat cards */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Users} label="Players" value={statsRes?.total_players ?? 0} />
          <StatCard icon={Hash} label="Rounds" value={statsRes?.total_rounds ?? 0} />
          <StatCard
            icon={Zap}
            label="Avg Round"
            value={statsRes ? statsRes.avg_round_score.toFixed(1) : "—"}
          />
          <StatCard icon={Star} label="Best Round" value={statsRes?.best_round_ever ?? 0} />
        </div>
      )}

      {/* Charts row */}
      {!isLoading && !statsError && statsRes && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

          {/* Score distribution */}
          <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Score Distribution
            </h2>
            {statsRes.score_distribution.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={statsRes.score_distribution} barCategoryGap="30%">
                  <XAxis
                    dataKey="bucket"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--accent) / 0.3)" }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {statsRes.score_distribution.map((_, i) => (
                      <Cell
                        key={i}
                        fill={i === statsRes.score_distribution.length - 1 ? BAR_COLOR : BAR_COLOR_ALT}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top segments */}
          <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Top Segments Hit
            </h2>
            {segmentData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  layout="vertical"
                  data={segmentData}
                  barCategoryGap="20%"
                  margin={{ left: 0, right: 8 }}
                >
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={42}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<SegmentTooltip />} cursor={{ fill: "hsl(var(--accent) / 0.3)" }} />
                  <Bar dataKey="count" fill={BAR_COLOR} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Leaderboard table */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Leaderboard
          </h2>
        </div>

        {lbLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {!lbLoading && entries.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <Target className="w-8 h-8" />
            <p className="text-sm">No games yet — hit the dartboard!</p>
          </div>
        )}

        {entries.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-10">#</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Player</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Rounds</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Best</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr
                    key={entry.player_name}
                    className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className={`font-bold ${RANK_COLORS[i] ?? "text-muted-foreground"}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{entry.player_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{entry.total_score}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{entry.rounds_played}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{entry.best_round}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
