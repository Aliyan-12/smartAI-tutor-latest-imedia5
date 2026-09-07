import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy, Flame, Zap, ArrowRight } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PageLoading from "../components/PageLoading";
import { gamificationApi } from "../services/api";
import type { LeaderboardData, LeaderboardEntry } from "../services/api";

const MEDAL = ["🥇", "🥈", "🥉"];

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) return <span style={{ fontSize: 22, width: 34, textAlign: "center" }}>{MEDAL[rank - 1]}</span>;
  return (
    <span style={{ width: 34, textAlign: "center", fontSize: 14, fontWeight: 800, color: "#94a3b8" }}>
      {rank}
    </span>
  );
}

function Row({ e }: { e: LeaderboardEntry }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
        borderRadius: 12, marginBottom: 8,
        background: e.is_me ? "linear-gradient(120deg,#eff6ff,#f0fdf4)" : "#fff",
        border: `1px solid ${e.is_me ? "#93c5fd" : "#e2e8f0"}`,
        boxShadow: e.is_me ? "0 2px 12px rgba(37,99,235,0.12)" : "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <RankBadge rank={e.rank} />
      <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, flexShrink: 0 }}>
        {(e.name || "?").charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: e.is_me ? 800 : 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {e.name}{e.is_me ? " (you)" : ""}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 10 }}>
          <span>Level {e.level}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Flame size={12} /> {e.streak}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <Zap size={15} color="#f59e0b" fill="#f59e0b" />
        <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{e.xp_total.toLocaleString()}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>XP</span>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gamificationApi.getLeaderboard()
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load leaderboard"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoading />;

  const groupLabel = data?.year_group || "your school";
  // Show the caller's own row separately when they're outside the visible top slice.
  const meVisible = data?.entries.some((e) => e.is_me);

  return (
    <div className="main-content">
        <div className="dashboard-content">
          {/* Hero */}
          <div style={{ background: "linear-gradient(120deg,#f59e0b 0%,#f97316 60%,#ea580c 100%)", borderRadius: 18, padding: "26px 30px", marginBottom: 20, position: "relative", overflow: "hidden", color: "#fff" }}>
            <div style={{ position: "absolute", top: -40, right: 30, fontSize: 150, opacity: 0.16, pointerEvents: "none" }}>🏆</div>
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "4px 12px", fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 10 }}>
                <Trophy size={13} /> Leaderboard
              </div>
              <h1 style={{ fontSize: 25, fontWeight: 800, margin: "0 0 4px", letterSpacing: "-0.01em" }}>XP Leaderboard</h1>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.92)", margin: 0 }}>
                How you rank against <strong>{groupLabel}</strong> — keep learning to climb higher!
              </p>
              {data?.my_rank && (
                <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 12, padding: "8px 16px" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Your rank</span>
                  <span style={{ fontSize: 20, fontWeight: 800 }}>#{data.my_rank}</span>
                  <span style={{ fontSize: 12, opacity: 0.9 }}>of {data.total_students}</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div style={{ padding: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {data && data.entries.length > 0 ? (
            <>
              {data.entries.map((e) => <Row key={e.student_id} e={e} />)}

              {/* If the student is below the visible slice, pin their own row at the bottom. */}
              {!meVisible && data.me && (
                <>
                  <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 18, margin: "2px 0 6px" }}>⋯</div>
                  <Row e={data.me} />
                </>
              )}
            </>
          ) : !error ? (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "#64748b" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🏁</div>
              <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800, color: "#0f172a" }}>No rankings yet</h3>
              <p style={{ fontSize: 14, margin: "0 0 16px" }}>Complete a lesson to earn XP and get on the board!</p>
              <button onClick={() => navigate("/lesson/setup")} style={{ background: "linear-gradient(135deg,#1a73e8,#4f46e5)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                Start a lesson <ArrowRight size={15} />
              </button>
            </div>
          ) : null}

          <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", marginTop: 16 }}>
            You're ranked within your year group. Earn XP by completing lessons, quizzes and puzzles.
          </p>
        </div>
      </div>
  );
}
