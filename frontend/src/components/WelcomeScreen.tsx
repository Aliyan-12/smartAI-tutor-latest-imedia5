import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gamificationApi, appointmentsApi, assignmentsApi } from "../services/api";
import type { DashboardData, Appointment, MyAssignment } from "../types";

interface HeroStats {
  streak: number;
  xp: number;
  level: number;
  xpPct: number;
}

interface Props {
  onPromptClick: (text: string) => void;
  onStatsLoaded?: (stats: HeroStats) => void;
}

const SUBJECT_COLORS: Record<string, { color: string; bg: string; icon: string }> = {
  maths:          { color: "#f97316", bg: "#fff7ed", icon: "🧮" },
  mathematics:    { color: "#f97316", bg: "#fff7ed", icon: "🧮" },
  science:        { color: "#22c55e", bg: "#f0fdf4", icon: "🔬" },
  biology:        { color: "#22c55e", bg: "#f0fdf4", icon: "🧬" },
  chemistry:      { color: "#ec4899", bg: "#fdf2f8", icon: "⚗️" },
  physics:        { color: "#06b6d4", bg: "#ecfeff", icon: "⚛️" },
  english:        { color: "#3b82f6", bg: "#eff6ff", icon: "📚" },
  history:        { color: "#a855f7", bg: "#faf5ff", icon: "🏛️" },
  geography:      { color: "#10b981", bg: "#ecfdf5", icon: "🌍" },
  art:            { color: "#f59e0b", bg: "#fffbeb", icon: "🎨" },
  "computer science": { color: "#6366f1", bg: "#eef2ff", icon: "💻" },
  computing:      { color: "#6366f1", bg: "#eef2ff", icon: "💻" },
};

function getSubjectStyle(subject: string) {
  return SUBJECT_COLORS[subject.toLowerCase()] ?? { color: "#64748b", bg: "#f8fafc", icon: "📖" };
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays < 0) return `Overdue by ${-diffDays}d`;
  return `Due in ${diffDays}d`;
}

const XP_PER_LEVEL = 500;

export default function WelcomeScreen({ onPromptClick, onStatsLoaded }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, appts, assgns] = await Promise.all([
        gamificationApi.getDashboard() as Promise<DashboardData>,
        appointmentsApi.list() as Promise<Appointment[]>,
        assignmentsApi.getMy() as Promise<MyAssignment[]>,
      ]);
      setDashData(dash);
      setAppointments(appts ?? []);
      setAssignments(assgns ?? []);
      const xpEarned = XP_PER_LEVEL - dash.xp_to_next_level;
      onStatsLoaded?.({
        streak: dash.profile.current_streak,
        xp: dash.profile.xp_total,
        level: dash.profile.xp_level,
        xpPct: Math.min(100, Math.max(0, (xpEarned / XP_PER_LEVEL) * 100)),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  if (loading) {
    return (
      <div className="ws-root ws-loading">
        <div className="ws-spinner" />
        <p>Loading your dashboard…</p>
      </div>
    );
  }

  if (error || !dashData) {
    return (
      <div className="ws-root ws-error">
        <div style={{ fontSize: 32 }}>⚠</div>
        <p style={{ color: "#64748b", fontSize: 14 }}>{error ?? "Could not load dashboard."}</p>
        <button className="ws-btn ws-btn--primary" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const { profile, daily_plan, continue_learning, xp_to_next_level } = dashData;

  const xpEarned = XP_PER_LEVEL - xp_to_next_level;
  const xpPct = Math.min(100, Math.max(0, (xpEarned / XP_PER_LEVEL) * 100));

  const activeSessions = appointments.filter((a) =>
    ["started", "paused"].includes(a.status)
  );
  const upcomingSessions = appointments.filter((a) => a.status === "confirmed");
  const completedSessions = appointments.filter((a) =>
    ["completed", "terminated"].includes(a.status)
  );
  const totalTimeStudied = completedSessions.reduce(
    (sum, a) => sum + (a.duration_minutes || 0),
    0
  );

  const pendingAssignments = assignments.filter(
    (a) => a.status === "assigned" || a.status === "started"
  );

  const hasSessions = activeSessions.length > 0 || upcomingSessions.length > 0;

  return (
    <>
      <style>{`
        .ws-root {
          padding: 24px 20px 40px;
          width: 100%;
          font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-sizing: border-box;
        }

        .ws-loading, .ws-error {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 60px 20px;
          color: #64748b;
          text-align: center;
        }

        .ws-spinner {
          width: 36px;
          height: 36px;
          border: 3px solid #e2e8f0;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: ws-spin 0.8s linear infinite;
        }

        @keyframes ws-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* ── Stats summary row ── */
        .ws-study-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 20px;
        }

        .ws-study-stat-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px 18px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }

        .ws-stat-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #94a3b8;
          margin-bottom: 8px;
        }

        .ws-stat-value {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1;
        }

        .ws-stat-sub {
          font-size: 12px;
          color: #64748b;
          margin-top: 4px;
        }

        /* ── Active session alert ── */
        .ws-active-session-alert {
          background: linear-gradient(135deg, #ecfdf5, #d1fae5);
          border: 1.5px solid #6ee7b7;
          border-left: 5px solid #10b981;
          border-radius: 14px;
          padding: 16px 20px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }

        .ws-active-pulse {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #10b981;
          flex-shrink: 0;
          animation: ws-pulse 1.5s ease-in-out infinite;
        }

        @keyframes ws-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
        }

        .ws-active-info { flex: 1; min-width: 0; }

        .ws-active-info strong {
          font-size: 15px;
          font-weight: 800;
          color: #064e3b;
          display: block;
          margin-bottom: 2px;
        }

        .ws-active-info span {
          font-size: 12px;
          color: #065f46;
        }

        /* ── Continue learning ── */
        .ws-continue-card {
          background: linear-gradient(135deg, #fff 60%, #eff6ff);
          border: 1.5px solid #bfdbfe;
          border-left: 5px solid #3b82f6;
          border-radius: 14px;
          padding: 20px 24px;
          margin-bottom: 20px;
          box-shadow: 0 1px 4px rgba(59,130,246,0.08);
        }

        .ws-continue-tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #3b82f6;
          background: #dbeafe;
          padding: 3px 10px;
          border-radius: 999px;
          margin-bottom: 12px;
        }

        .ws-continue-inner {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
        }

        .ws-robot-icon {
          font-size: 40px;
          flex-shrink: 0;
          line-height: 1;
          margin-top: 2px;
        }

        .ws-continue-info {
          flex: 1;
          min-width: 200px;
        }

        .ws-continue-topic {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 3px;
        }

        .ws-continue-subject {
          font-size: 13px;
          color: #64748b;
          margin-bottom: 10px;
        }

        .ws-continue-progress {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }

        .ws-prog-track {
          flex: 1;
          height: 9px;
          background: #dbeafe;
          border-radius: 999px;
          overflow: hidden;
        }

        .ws-prog-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
        }

        .ws-prog-pct {
          font-size: 12px;
          font-weight: 700;
          color: #3b82f6;
          white-space: nowrap;
        }

        .ws-continue-last {
          font-size: 12px;
          color: #94a3b8;
          font-style: italic;
        }

        .ws-continue-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
          min-width: 140px;
        }

        .ws-start-cta {
          background: #fff;
          border: 1.5px dashed #cbd5e1;
          border-radius: 14px;
          padding: 28px 24px;
          text-align: center;
          margin-bottom: 20px;
        }

        /* Subject launch cards */
        .ws-subject-cards {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
          margin: 14px 0 18px;
        }

        .ws-subject-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 14px 18px;
          border-radius: 14px;
          cursor: pointer;
          border: 2px solid transparent;
          transition: transform 0.18s, box-shadow 0.18s;
          min-width: 90px;
          flex: 1 1 90px;
          max-width: 130px;
          animation: ws-subject-pop 0.4s ease both;
        }

        .ws-subject-card:hover {
          transform: translateY(-4px);
        }

        @keyframes ws-subject-pop {
          from { opacity: 0; transform: scale(0.85) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .ws-subject-card-icon { font-size: 28px; line-height: 1; }
        .ws-subject-card-name { font-size: 13px; font-weight: 700; color: #0f172a; }
        .ws-subject-card-tag { font-size: 10px; font-weight: 500; color: #64748b; }

        /* ── Two-column grid ── */
        .ws-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-bottom: 20px;
        }

        /* ── Generic card ── */
        .ws-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 18px 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        }

        .ws-card-title {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #94a3b8;
          margin-bottom: 14px;
        }

        /* ── Session list items ── */
        .ws-session-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          margin-bottom: 8px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          transition: background 0.15s, border-color 0.15s;
        }

        .ws-session-item:hover {
          background: #f1f5f9;
          border-color: #cbd5e1;
        }

        .ws-session-item:last-child { margin-bottom: 0; }

        .ws-session-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.9), 0 0 0 4px currentColor;
        }

        .ws-subject-icon-bubble {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }

        .ws-session-info { flex: 1; min-width: 0; }

        .ws-session-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ws-session-meta {
          font-size: 11px;
          color: #64748b;
          margin: 0;
        }

        .ws-session-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .ws-badge--started { background: #d1fae5; color: #065f46; }
        .ws-badge--paused { background: #fef3c7; color: #92400e; }
        .ws-badge--confirmed { background: #dbeafe; color: #1e40af; }

        /* ── Assignment items ── */
        .ws-assign-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          margin-bottom: 8px;
          background: #f8fafc;
          border-left: 3px solid #f59e0b;
          border-top: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
        }

        .ws-assign-item:last-child { margin-bottom: 0; }

        .ws-assign-icon { font-size: 18px; flex-shrink: 0; }

        .ws-assign-info { flex: 1; min-width: 0; }

        .ws-assign-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ws-assign-meta {
          font-size: 11px;
          color: #64748b;
          margin: 0;
        }

        .ws-assign-due {
          font-size: 11px;
          font-weight: 700;
          color: #d97706;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .ws-assign-due--overdue { color: #dc2626; }

        /* ── Daily plan items ── */
        .ws-plan-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 8px;
          margin-bottom: 6px;
          cursor: pointer;
          border-left: 3px solid transparent;
          transition: background 0.15s;
          background: #f8fafc;
        }

        .ws-plan-item:last-child { margin-bottom: 0; }

        .ws-plan-item--weak { border-left-color: #ef4444; background: #fff5f5; }
        .ws-plan-item--weak:hover { background: #fee2e2; }

        .ws-plan-item--review { border-left-color: #3b82f6; background: #f0f6ff; }
        .ws-plan-item--review:hover { background: #dbeafe; }

        .ws-plan-item--boost { border-left-color: #22c55e; background: #f0faf4; }
        .ws-plan-item--boost:hover { background: #dcfce7; }

        .ws-plan-icon { font-size: 16px; flex-shrink: 0; }

        .ws-plan-body { flex: 1; min-width: 0; }

        .ws-plan-topic {
          font-size: 13px;
          font-weight: 600;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0 0 2px;
        }

        .ws-plan-sub {
          font-size: 11px;
          color: #64748b;
          margin: 0;
        }

        .ws-plan-arrow { color: #cbd5e1; font-size: 16px; }

        .ws-empty-plan {
          font-size: 13px;
          color: #94a3b8;
          text-align: center;
          padding: 16px 0;
          line-height: 1.5;
        }

        /* ── Quick actions ── */
        .ws-quick-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .ws-quick-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 14px 8px;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
          font-family: inherit;
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .ws-quick-btn .ws-q-icon {
          font-size: 22px;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.15));
        }

        .ws-quick-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 14px rgba(59,130,246,0.14);
        }

        .ws-quick-btn--ai   { border-color: #bfdbfe; background: #eff6ff; }
        .ws-quick-btn--ai:hover   { border-color: #3b82f6; background: #dbeafe; }
        .ws-quick-btn--quiz { border-color: #d1fae5; background: #f0fdf4; }
        .ws-quick-btn--quiz:hover { border-color: #22c55e; background: #dcfce7; }
        .ws-quick-btn--sess { border-color: #e0e7ff; background: #eef2ff; }
        .ws-quick-btn--sess:hover { border-color: #6366f1; background: #e0e7ff; }
        .ws-quick-btn--prog { border-color: #fde68a; background: #fffbeb; }
        .ws-quick-btn--prog:hover { border-color: #f59e0b; background: #fef3c7; }

        /* ── Buttons ── */
        .ws-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          font-family: inherit;
          transition: all 0.18s;
          white-space: nowrap;
        }

        .ws-btn--primary { background: #3b82f6; color: #fff; }
        .ws-btn--primary:hover { background: #2563eb; }

        .ws-btn--green { background: #10b981; color: #fff; }
        .ws-btn--green:hover { background: #059669; }

        .ws-btn--orange { background: #1a73e8; color: #fff; box-shadow: 0 2px 10px rgba(26,115,232,0.3); }
        .ws-btn--orange:hover { background: #1557b0; }

        .ws-btn--ghost { background: #f1f5f9; color: #374151; border: 1px solid #e2e8f0; }
        .ws-btn--ghost:hover { background: #e2e8f0; }

        .ws-btn--outline { background: transparent; color: #3b82f6; border: 1.5px solid #3b82f6; }
        .ws-btn--outline:hover { background: #eff6ff; }

        .ws-btn--sm { padding: 7px 12px; font-size: 12px; }

        @media (max-width: 900px) {
          .ws-study-stats { grid-template-columns: repeat(2, 1fr); }
        }

        @media (max-width: 720px) {
          .ws-grid { grid-template-columns: 1fr; }
          .ws-study-stats { grid-template-columns: repeat(2, 1fr); }
          .ws-continue-actions { flex-direction: row; flex-wrap: wrap; min-width: unset; width: 100%; }
        }

        @media (max-width: 480px) {
          .ws-study-stats { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <div className="ws-root">
        {/* Study Stats Row */}
        <div className="ws-study-stats">
          <div className="ws-study-stat-card">
            <div className="ws-stat-label">Sessions Done</div>
            <div className="ws-stat-value">{completedSessions.length}</div>
            <div className="ws-stat-sub">all time</div>
          </div>
          <div className="ws-study-stat-card">
            <div className="ws-stat-label">Time Studied</div>
            <div className="ws-stat-value">
              {totalTimeStudied >= 60
                ? `${Math.floor(totalTimeStudied / 60)}h ${totalTimeStudied % 60}m`
                : `${totalTimeStudied}m`}
            </div>
            <div className="ws-stat-sub">total minutes</div>
          </div>
          <div className="ws-study-stat-card">
            <div className="ws-stat-label">Assignments</div>
            <div className="ws-stat-value">{pendingAssignments.length}</div>
            <div className="ws-stat-sub">pending</div>
          </div>
          <div className="ws-study-stat-card">
            <div className="ws-stat-label">Upcoming</div>
            <div className="ws-stat-value">{upcomingSessions.length}</div>
            <div className="ws-stat-sub">confirmed sessions</div>
          </div>
        </div>

        {/* Active session alert */}
        {activeSessions.length > 0 && (
          <div className="ws-active-session-alert">
            <div className="ws-active-pulse" />
            <div className="ws-active-info">
              <strong>
                {activeSessions[0].status === "paused" ? "⏸ Paused" : "▶ Live"}: {activeSessions[0].title}
              </strong>
              <span>
                {activeSessions[0].subject} ·{" "}
                {activeSessions[0].status === "paused"
                  ? "Session is paused — resume where you left off"
                  : "Session is in progress"}
              </span>
            </div>
            <button
              className="ws-btn ws-btn--green"
              onClick={() => navigate(`/session/${activeSessions[0].id}`)}
            >
              {activeSessions[0].status === "paused" ? "Resume" : "Rejoin"} →
            </button>
          </div>
        )}

        {/* Continue learning / Start CTA */}
        {continue_learning ? (
          <div className="ws-continue-card">
            <div className="ws-continue-tag">▶ Continue Learning</div>
            <div className="ws-continue-inner">
              <div className="ws-robot-icon">🤖</div>
              <div className="ws-continue-info">
                <h2 className="ws-continue-topic">{continue_learning.topic}</h2>
                <p className="ws-continue-subject">
                  {continue_learning.subject} · {continue_learning.key_stage}
                </p>
                <div className="ws-continue-progress">
                  <div className="ws-prog-track">
                    <div
                      className="ws-prog-fill"
                      style={{ width: `${Math.max(continue_learning.mastery, 2)}%` }}
                    />
                  </div>
                  <span className="ws-prog-pct">
                    {continue_learning.mastery > 0
                      ? `${continue_learning.mastery}% mastery`
                      : "Just started"}
                  </span>
                </div>
                {continue_learning.last_mistake && (
                  <p className="ws-continue-last">
                    Last note: "{continue_learning.last_mistake}"
                  </p>
                )}
              </div>
              <div className="ws-continue-actions">
                <button
                  className="ws-btn ws-btn--primary"
                  onClick={() =>
                    onPromptClick(
                      `Let's continue where we left off. Topic: ${continue_learning.topic} (${continue_learning.subject}, ${continue_learning.key_stage})`
                    )
                  }
                >
                  ▶ Resume Lesson
                </button>
                <button
                  className="ws-btn ws-btn--ghost"
                  onClick={() =>
                    onPromptClick(
                      `I'd like to study a different topic in ${continue_learning.subject} for ${continue_learning.key_stage}.`
                    )
                  }
                >
                  Different Topic
                </button>
                <button
                  className="ws-btn ws-btn--outline"
                  onClick={() =>
                    onPromptClick(
                      `Quiz me on ${continue_learning.topic} (${continue_learning.subject}).`
                    )
                  }
                >
                  ⚡ Quick Quiz
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="ws-start-cta">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
              <img
                src="/images/teaching-robot.png"
                alt="Teaching robot"
                draggable={false}
                style={{ width: 70, height: "auto", objectFit: "contain", pointerEvents: "none", flexShrink: 0 }}
              />
              <div style={{ textAlign: "left" }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>Start Your First Session</h2>
                <p style={{ fontSize: 13, color: "#64748b", margin: 0, lineHeight: 1.5 }}>
                  Pick a subject and your AI tutor will personalise the lesson for you.
                </p>
              </div>
            </div>
            {/* Subject launch cards */}
            <div className="ws-subject-cards">
              {[
                { icon: "🧮", name: "Maths",   tag: "Numbers & algebra",  color: "#f97316", bg: "#fff7ed", border: "#fed7aa" },
                { icon: "🔬", name: "Science",  tag: "Explore the world",  color: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0" },
                { icon: "📚", name: "English",  tag: "Read & write",       color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
                { icon: "🏛️", name: "History",  tag: "Past events",        color: "#a855f7", bg: "#faf5ff", border: "#d8b4fe" },
                { icon: "⚗️", name: "Chemistry",tag: "Elements & reactions",color: "#ec4899", bg: "#fdf2f8", border: "#f9a8d4" },
              ].map((s, i) => (
                <div
                  key={s.name}
                  className="ws-subject-card"
                  style={{
                    background: s.bg,
                    borderColor: s.border,
                    animationDelay: `${i * 0.07}s`,
                  }}
                  onClick={() =>
                    onPromptClick(`I'd like to start learning ${s.name}. Can you help me pick a topic?`)
                  }
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 20px ${s.color}30`;
                    (e.currentTarget as HTMLDivElement).style.borderColor = s.color;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                    (e.currentTarget as HTMLDivElement).style.borderColor = s.border;
                  }}
                >
                  {s.name === "Science" ? (
                    <img
                      src="/images/sci-robot.png"
                      alt="Science robot"
                      draggable={false}
                      style={{ width: 36, height: 36, objectFit: "contain", pointerEvents: "none" }}
                    />
                  ) : (
                    <span className="ws-subject-card-icon">{s.icon}</span>
                  )}
                  <span className="ws-subject-card-name">{s.name}</span>
                  <span className="ws-subject-card-tag">{s.tag}</span>
                </div>
              ))}
            </div>
            <button
              className="ws-btn ws-btn--orange"
              onClick={() =>
                onPromptClick("Let's start a new topic. What subjects do you have materials for?")
              }
            >
              Browse All Subjects →
            </button>
          </div>
        )}

        {/* Two-column: Sessions + Assignments — always shown */}
        <div className="ws-grid" style={{ marginBottom: 20 }}>
            {/* Upcoming / Active Sessions */}
            <div className="ws-card">
              <div className="ws-card-title">Your Sessions</div>

              {activeSessions.length === 0 && upcomingSessions.length === 0 ? (
                <p className="ws-empty-plan">No active or upcoming sessions.</p>
              ) : (
                <>
                  {activeSessions.map((a) => {
                    const ss = getSubjectStyle(a.subject);
                    return (
                    <div key={a.id} className="ws-session-item">
                      <div
                        className="ws-subject-icon-bubble"
                        style={{ background: ss.bg }}
                      >{ss.icon}</div>
                      <div
                        className="ws-session-dot"
                        style={{ background: a.status === "paused" ? "#f59e0b" : "#10b981", color: a.status === "paused" ? "#f59e0b" : "#10b981" }}
                      />
                      <div className="ws-session-info">
                        <p className="ws-session-title">{a.title}</p>
                        <p className="ws-session-meta">
                          {a.subject} · {a.teacher_name ?? "Teacher"}
                        </p>
                      </div>
                      <span className={`ws-session-badge ws-badge--${a.status}`}>
                        {a.status === "paused" ? "Paused" : "Live"}
                      </span>
                      <button
                        className="ws-btn ws-btn--green ws-btn--sm"
                        onClick={() => navigate(`/session/${a.id}`)}
                      >
                        {a.status === "paused" ? "Resume" : "Rejoin"}
                      </button>
                    </div>
                    );
                  })}

                  {upcomingSessions.slice(0, 3).map((a) => {
                    const ss = getSubjectStyle(a.subject);
                    return (
                    <div key={a.id} className="ws-session-item">
                      <div
                        className="ws-subject-icon-bubble"
                        style={{ background: ss.bg }}
                      >{ss.icon}</div>
                      <div className="ws-session-dot" style={{ background: "#3b82f6", color: "#3b82f6" }} />
                      <div className="ws-session-info">
                        <p className="ws-session-title">{a.title}</p>
                        <p className="ws-session-meta">
                          {a.subject} · {formatDate(a.scheduled_at)}
                        </p>
                      </div>
                      <span className="ws-session-badge ws-badge--confirmed">Confirmed</span>
                      <button
                        className="ws-btn ws-btn--primary ws-btn--sm"
                        onClick={() => navigate(`/session/${a.id}`)}
                      >
                        Join
                      </button>
                    </div>
                    );
                  })}
                </>
              )}

              <button
                className="ws-btn ws-btn--ghost ws-btn--sm"
                style={{ width: "100%", marginTop: 10 }}
                onClick={() => navigate("/sessions")}
              >
                View All Sessions →
              </button>
            </div>

            {/* Assignments */}
            <div className="ws-card">
              <div className="ws-card-title">Assignments Due</div>

              {pendingAssignments.length === 0 ? (
                <p className="ws-empty-plan">No pending assignments. You're all caught up!</p>
              ) : (
                pendingAssignments.slice(0, 4).map((a) => {
                  const isOverdue =
                    a.homework.due_date && new Date(a.homework.due_date) < new Date();
                  return (
                    <div key={a.id} className="ws-assign-item">
                      <span className="ws-assign-icon">
                        {a.homework.assignment_type === "reading"
                          ? "📖"
                          : a.homework.assignment_type === "revision"
                          ? "📝"
                          : a.homework.assignment_type === "prep"
                          ? "🎯"
                          : "📚"}
                      </span>
                      <div className="ws-assign-info">
                        <p className="ws-assign-title">{a.homework.title}</p>
                        <p className="ws-assign-meta">
                          {a.homework.subject} · {a.homework.estimated_minutes}min ·{" "}
                          {a.status === "started" ? "In progress" : "Not started"}
                        </p>
                      </div>
                      {a.homework.due_date && (
                        <span
                          className={`ws-assign-due${isOverdue ? " ws-assign-due--overdue" : ""}`}
                        >
                          {formatDueDate(a.homework.due_date)}
                        </span>
                      )}
                    </div>
                  );
                })
              )}

              <button
                className="ws-btn ws-btn--ghost ws-btn--sm"
                style={{ width: "100%", marginTop: 10 }}
                onClick={() => navigate("/assignments")}
              >
                View All Assignments →
              </button>
            </div>
        </div>

        {/* Two-column: Today's Plan + Quick Actions */}
        <div className="ws-grid">
          <div className="ws-card">
            <div className="ws-card-title">Today's Study Plan</div>

            {daily_plan.weak_spots.length === 0 &&
              daily_plan.spaced_review.length === 0 &&
              daily_plan.confidence_boost.length === 0 ? (
                <p className="ws-empty-plan">
                  No recommendations yet. Complete a lesson to unlock your personalised plan.
                </p>
              ) : null}

            {daily_plan.weak_spots.map((ws, i) => (
              <div
                key={i}
                className="ws-plan-item ws-plan-item--weak"
                onClick={() =>
                  onPromptClick(
                    `I need help improving on ${ws.topic} in ${ws.subject}. Please teach me with targeted questions.`
                  )
                }
              >
                <span className="ws-plan-icon">🔧</span>
                <div className="ws-plan-body">
                  <p className="ws-plan-topic">{ws.topic}</p>
                  <p className="ws-plan-sub">{ws.subject} · Needs practice</p>
                </div>
                <span className="ws-plan-arrow">›</span>
              </div>
            ))}

            {daily_plan.spaced_review.map((sr, i) => (
              <div
                key={i}
                className="ws-plan-item ws-plan-item--review"
                onClick={() =>
                  onPromptClick(
                    `Let's do a spaced-repetition review of ${sr.topic} in ${sr.subject}.`
                  )
                }
              >
                <span className="ws-plan-icon">📅</span>
                <div className="ws-plan-body">
                  <p className="ws-plan-topic">{sr.topic}</p>
                  <p className="ws-plan-sub">
                    {sr.subject} · Last practised {sr.days_since}d ago
                  </p>
                </div>
                <span className="ws-plan-arrow">›</span>
              </div>
            ))}

            {daily_plan.confidence_boost.map((cb, i) => (
              <div
                key={i}
                className="ws-plan-item ws-plan-item--boost"
                onClick={() =>
                  onPromptClick(
                    `Let's build confidence on ${cb.topic} in ${cb.subject}. Quiz me on it.`
                  )
                }
              >
                <span className="ws-plan-icon">⚡</span>
                <div className="ws-plan-body">
                  <p className="ws-plan-topic">{cb.topic}</p>
                  <p className="ws-plan-sub">{cb.subject} · Build momentum</p>
                </div>
                <span className="ws-plan-arrow">›</span>
              </div>
            ))}
          </div>

          <div className="ws-card">
            <div className="ws-card-title">Quick Actions</div>
            <div className="ws-quick-grid">
              <button
                className="ws-quick-btn ws-quick-btn--ai"
                onClick={() =>
                  onPromptClick(
                    "Let's start a new topic. What subjects do you have materials for?"
                  )
                }
              >
                <span className="ws-q-icon">🤖</span>
                Ask AI Tutor
              </button>
              <button
                className="ws-quick-btn ws-quick-btn--quiz"
                onClick={() =>
                  onPromptClick(
                    "Can you quiz me on something I haven't practised recently?"
                  )
                }
              >
                <span className="ws-q-icon">⚡</span>
                Quick Quiz
              </button>
              <button
                className="ws-quick-btn ws-quick-btn--sess"
                onClick={() => navigate("/sessions")}
              >
                <span className="ws-q-icon">📅</span>
                My Sessions
              </button>
              <button
                className="ws-quick-btn ws-quick-btn--prog"
                onClick={() => navigate("/progress")}
              >
                <span className="ws-q-icon">📊</span>
                My Progress
              </button>
            </div>
          </div>
        </div>

        {/* AI Tutor Tip */}
        <div style={{ padding: "14px 18px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <p style={{ flex: 1, fontSize: 13, color: "#166534", margin: 0, fontStyle: "italic" }}>
            <strong>AI Tip: </strong>
            {daily_plan.weak_spots.length > 0
              ? `Focus on improving "${daily_plan.weak_spots[0].topic}" in ${daily_plan.weak_spots[0].subject} — it needs the most attention right now.`
              : daily_plan.spaced_review.length > 0
              ? `You haven't practised "${daily_plan.spaced_review[0].topic}" in a while — a quick review will reinforce your memory.`
              : "Keep up the great work! Regular daily practice is the key to long-term learning success."}
          </p>
          <button
            onClick={() => onPromptClick("What should I focus on studying today based on my progress?")}
            style={{ fontSize: 13, fontWeight: 600, color: "#16a34a", background: "white", border: "1px solid #bbf7d0", borderRadius: 7, padding: "5px 14px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >
            Ask AI →
          </button>
        </div>

        {/* Bottom links row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 32, flexWrap: "wrap" }}>
          {[
            { icon: "📊", label: "My Progress", path: "/progress" },
            { icon: "📅", label: "My Sessions", path: "/sessions" },
            { icon: "📝", label: "Assignments", path: "/assignments" },
            { icon: "⚙️", label: "Settings", path: "/settings" },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{ flex: "1 1 120px", display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#0f172a", cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s, box-shadow 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(59,130,246,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; }}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
