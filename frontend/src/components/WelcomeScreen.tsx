import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gamificationApi, appointmentsApi, assignmentsApi } from "../services/api";
import type { DashboardData, Appointment, MyAssignment } from "../types";

interface Props {
  onPromptClick: (text: string) => void;
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

export default function WelcomeScreen({ onPromptClick }: Props) {
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
          max-width: 1060px;
          margin: 0 auto;
          width: 100%;
          font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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

        .ws-greeting-banner {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
          flex-wrap: wrap;
        }

        .ws-greeting-left h1 {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 4px;
        }

        .ws-greeting-left h1 span { color: #1a73e8; }

        .ws-greeting-left p {
          font-size: 14px;
          color: #64748b;
          margin: 0;
        }

        .ws-stats-row {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .ws-stat-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          padding: 7px 14px;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
        }

        .ws-stat-chip .ws-chip-icon { font-size: 16px; }

        .ws-xp-block {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 160px;
        }

        .ws-xp-meta {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 600;
        }

        .ws-xp-meta .ws-xp-val { color: #0f172a; }
        .ws-xp-meta .ws-level { color: #3b82f6; }

        .ws-xp-bar-track {
          height: 8px;
          background: #e2e8f0;
          border-radius: 999px;
          overflow: hidden;
        }

        .ws-xp-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
          transition: width 0.6s ease;
        }

        .ws-xp-next {
          font-size: 11px;
          color: #94a3b8;
          text-align: right;
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

        .ws-start-cta .ws-cta-icon {
          font-size: 40px;
          margin-bottom: 10px;
        }

        .ws-start-cta h2 {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px;
        }

        .ws-start-cta p {
          font-size: 13px;
          color: #64748b;
          max-width: 340px;
          margin: 0 auto 16px;
          line-height: 1.5;
        }

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
        }

        .ws-session-item:last-child { margin-bottom: 0; }

        .ws-session-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
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
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
          font-family: inherit;
          text-align: center;
        }

        .ws-quick-btn .ws-q-icon { font-size: 20px; }

        .ws-quick-btn:hover {
          border-color: #3b82f6;
          background: #eff6ff;
          box-shadow: 0 2px 6px rgba(59,130,246,0.1);
        }

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
          .ws-greeting-banner { flex-direction: column; align-items: flex-start; }
        }

        @media (max-width: 480px) {
          .ws-study-stats { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <div className="ws-root">
        {/* Greeting banner */}
        <div className="ws-greeting-banner">
          <div className="ws-greeting-left">
            <h1>
              {getGreeting()}, <span>{firstName}</span>! 👋
            </h1>
            <p>Let's keep learning and growing.</p>
          </div>

          <div className="ws-stats-row">
            <div className="ws-stat-chip">
              <span className="ws-chip-icon">🔥</span>
              {profile.current_streak} day streak
            </div>

            <div className="ws-xp-block">
              <div className="ws-xp-meta">
                <span className="ws-xp-val">⭐ {profile.xp_total.toLocaleString()} XP</span>
                <span className="ws-level">Level {profile.xp_level}</span>
              </div>
              <div className="ws-xp-bar-track">
                <div className="ws-xp-bar-fill" style={{ width: `${xpPct}%` }} />
              </div>
              <div className="ws-xp-next">{xp_to_next_level} XP to next level</div>
            </div>

            <div className="ws-stat-chip">
              <span className="ws-chip-icon">🏅</span>
              Level {profile.xp_level}
            </div>
          </div>
        </div>

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
            <div className="ws-cta-icon">🚀</div>
            <h2>Start Your First Session</h2>
            <p>
              Pick a subject and your AI tutor will personalise the lesson for you.
            </p>
            <button
              className="ws-btn ws-btn--orange"
              onClick={() =>
                onPromptClick("Let's start a new topic. What subjects do you have materials for?")
              }
            >
              Begin Learning
            </button>
          </div>
        )}

        {/* Two-column: Sessions + Assignments */}
        {(hasSessions || pendingAssignments.length > 0) && (
          <div className="ws-grid" style={{ marginBottom: 20 }}>
            {/* Upcoming / Active Sessions */}
            <div className="ws-card">
              <div className="ws-card-title">Your Sessions</div>

              {activeSessions.length === 0 && upcomingSessions.length === 0 ? (
                <p className="ws-empty-plan">No active or upcoming sessions.</p>
              ) : (
                <>
                  {activeSessions.map((a) => (
                    <div key={a.id} className="ws-session-item">
                      <div
                        className="ws-session-dot"
                        style={{ background: a.status === "paused" ? "#f59e0b" : "#10b981" }}
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
                  ))}

                  {upcomingSessions.slice(0, 3).map((a) => (
                    <div key={a.id} className="ws-session-item">
                      <div className="ws-session-dot" style={{ background: "#3b82f6" }} />
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
                  ))}
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
        )}

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
                className="ws-quick-btn"
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
                className="ws-quick-btn"
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
                className="ws-quick-btn"
                onClick={() => navigate("/sessions")}
              >
                <span className="ws-q-icon">📅</span>
                My Sessions
              </button>
              <button
                className="ws-quick-btn"
                onClick={() => navigate("/progress")}
              >
                <span className="ws-q-icon">📊</span>
                My Progress
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
