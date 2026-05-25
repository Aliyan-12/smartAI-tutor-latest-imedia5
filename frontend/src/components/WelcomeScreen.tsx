import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gamificationApi, appointmentsApi, assignmentsApi, chatApi } from "../services/api";
import type { DashboardData, Appointment, MyAssignment } from "../types";

interface SessionSummary {
  messageCount: number;
  userTurns: number;
  quizCount: number;
  lastAiSnippet: string;
  topicLine: string;
}

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

  useEffect(() => {
    const active = appointments.filter((a) => ["started", "paused"].includes(a.status));
    if (active.length === 0) return;
    active.forEach(async (appt) => {
      try {
        const data = await chatApi.getOrCreateSessionChat(appt.id) as {
          session_id: string;
          messages: Array<{ id: number; role: string; content: string; timestamp: string }>;
        };
        const msgs = data.messages ?? [];
        const aiMsgs = msgs.filter((m) => m.role === "assistant");
        const userMsgs = msgs.filter((m) => m.role === "user");
        const quizCount = aiMsgs.filter((m) =>
          m.content.includes("[QUIZ_OFFER") || m.content.toLowerCase().includes("quiz")
        ).length;
        const lastAi = aiMsgs[aiMsgs.length - 1]?.content ?? "";
        const snippet = lastAi.replace(/\[.*?\]/g, "").trim().slice(0, 120);
        const topicLine = [
          `${msgs.length} messages`,
          userMsgs.length > 0 ? `${userMsgs.length} responses` : null,
          quizCount > 0 ? `${quizCount} quiz attempt${quizCount > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        setSessionSummaries((prev) => ({
          ...prev,
          [appt.id]: {
            messageCount: msgs.length,
            userTurns: userMsgs.length,
            quizCount,
            lastAiSnippet: snippet,
            topicLine,
          },
        }));
      } catch {
        // silently skip if chat not yet created
      }
    });
  }, [appointments]);

  const [helpInput, setHelpInput] = useState("");
  const helpInputRef = useRef<HTMLInputElement>(null);
  const [sessionSummaries, setSessionSummaries] = useState<Record<number, SessionSummary>>({});

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
          padding: 20px 24px 40px;
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
        @keyframes ws-chips-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ws-chips-track {
          display: flex;
          gap: 6px;
          animation: ws-chips-scroll 14s linear infinite;
          width: max-content;
        }
        .ws-chips-track:hover {
          animation-play-state: paused;
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

        /* ── Section 1: Continue Learning card ── */
        .ws-cl-card {
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
          padding: 24px 28px;
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
        }

        .ws-cl-badge {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #1a73e8;
          background: #eff6ff;
          padding: 3px 10px;
          border-radius: 999px;
          display: inline-block;
          margin-bottom: 12px;
          align-self: flex-start;
        }

        .ws-cl-body {
          display: grid;
          grid-template-columns: 30% 25% 20% 20%;
          gap: 14px;
          align-items: center;
        }

        .ws-cl-info {
          flex: 1;
          min-width: 0;
        }

        .ws-cl-topic {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 4px;
        }

        .ws-cl-subject {
          font-size: 13px;
          color: #64748b;
          margin: 0 0 12px;
        }

        .ws-cl-prog-row {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-bottom: 10px;
        }

        .ws-cl-prog-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .ws-cl-prog-label {
          font-size: 12px;
          color: #64748b;
        }

        .ws-cl-prog-track {
          height: 8px;
          background: #e2e8f0;
          border-radius: 999px;
          width: 100%;
          overflow: hidden;
        }

        .ws-cl-prog-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #1a73e8, #60a5fa);
          transition: width 0.4s ease;
        }

        .ws-cl-prog-mins {
          font-size: 11px;
          color: #94a3b8;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .ws-cl-lp-box {
          background: #f0f6ff;
          border: 1.5px solid #bfdbfe;
          border-radius: 12px;
          padding: 12px 14px;
          align-self: stretch;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .ws-cl-lp-label {
          font-size: 11px;
          font-weight: 700;
          color: #1a73e8;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .ws-cl-lp-msg {
          font-size: 12px;
          color: #475569;
          line-height: 1.55;
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .ws-cl-last-msg {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12px;
          color: #64748b;
          margin-top: 10px;
          line-height: 1.5;
        }

        .ws-cl-robot {
          width: 130px;
          flex-shrink: 0;
          object-fit: contain;
          align-self: center;
        }

        .ws-cl-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
          min-width: 170px;
          align-self: center;
        }

        .ws-cl-btn-primary {
          background: #1a73e8;
          color: #fff;
          padding: 11px 20px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.18s;
        }

        .ws-cl-btn-primary:hover { background: #1557b0; }

        .ws-cl-btn-secondary {
          background: #fff;
          color: #0f172a;
          border: 1.5px solid #e2e8f0;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.18s, background 0.18s;
        }

        .ws-cl-btn-secondary:hover { border-color: #94a3b8; background: #f8fafc; }

        .ws-cl-btn-end {
          background: #fff0f0;
          color: #dc2626;
          border: 1.5px solid #fecaca;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.18s, border-color 0.18s;
        }

        .ws-cl-btn-end:hover { background: #fee2e2; border-color: #dc2626; }

        .ws-cl-meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }

        .ws-cl-meta-pill {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 999px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          color: #475569;
          white-space: nowrap;
        }

        .ws-cl-stats-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin: 10px 0 8px;
          padding: 8px 12px;
          background: #f8fafc;
          border-radius: 8px;
          border: 1px solid #f1f5f9;
        }

        .ws-cl-stat {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          white-space: nowrap;
        }

        /* ── Section 2: Recommended for You ── */
        .ws-rec-row {
          display: grid;
          grid-template-columns: 3fr 2fr;
          gap: 16px;
          margin-bottom: 20px;
        }

        .ws-rec-left-header {
          font-size: 15px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 12px;
        }

        .ws-rec-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ws-rec-card:last-child { margin-bottom: 0; }

        .ws-rec-icon-bubble {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          flex-shrink: 0;
        }

        .ws-rec-body { flex: 1; min-width: 0; }

        .ws-rec-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
          display: inline-block;
          margin-bottom: 4px;
        }

        .ws-rec-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ws-rec-desc {
          font-size: 11px;
          color: #64748b;
          margin: 0;
        }

        .ws-rec-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          flex-shrink: 0;
        }

        .ws-rec-mins {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          white-space: nowrap;
        }

        .ws-rec-start-btn {
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          font-family: inherit;
          color: #fff;
          white-space: nowrap;
          transition: opacity 0.18s;
        }

        .ws-rec-start-btn:hover { opacity: 0.88; }

        .ws-promo-card {
          background: linear-gradient(135deg, #1e3a5f 0%, #1a73e8 100%);
          border-radius: 16px;
          padding: 24px;
          color: #fff;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
        }

        .ws-promo-support {
          font-size: 12px;
          opacity: 0.8;
          margin: 0 0 8px;
        }

        .ws-promo-heading {
          font-size: 17px;
          font-weight: 800;
          margin: 0 0 12px;
          line-height: 1.3;
        }

        .ws-promo-list {
          list-style: none;
          padding: 0;
          margin: 0 0 16px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .ws-promo-list li {
          font-size: 13px;
          opacity: 0.9;
        }

        .ws-promo-btn {
          background: #fff;
          color: #1a73e8;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          align-self: flex-start;
          font-family: inherit;
          transition: opacity 0.18s;
        }

        .ws-promo-btn:hover { opacity: 0.88; }

        /* ── Section 3: Pick a Subject ── */
        .ws-subj-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 20px;
        }

        .ws-subj-card {
          border-radius: 16px;
          padding: 20px 18px;
          cursor: pointer;
          transition: transform 0.18s, box-shadow 0.18s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }

        .ws-subj-card:hover { transform: translateY(-3px); }

        .ws-subj-img {
          width: 100%;
          height: 190px;
          object-fit: contain;
          display: block;
        }

        .ws-subj-name {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin: 10px 0 6px;
        }

        .ws-subj-desc {
          font-size: 12px;
          color: #64748b;
          line-height: 1.5;
          margin-bottom: 14px;
          flex: 1;
          text-align: center;
        }

        .ws-subj-btn {
          width: 100%;
          border-radius: 999px;
          padding: 9px 0;
          font-weight: 700;
          font-size: 13px;
          border: none;
          cursor: pointer;
          font-family: inherit;
          color: #fff;
          transition: opacity 0.18s;
        }

        .ws-subj-btn:hover { opacity: 0.88; }

        /* ── Section 4: Need Help bar ── */
        .ws-help-bar {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 12px 20px 12px 14px;
          display: flex;
          align-items: center;
          gap: 16px;
          margin-top: 8px;
        }

        .ws-help-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .ws-help-text-heading {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 2px;
        }

        .ws-help-text-sub {
          font-size: 12px;
          color: #64748b;
          margin: 0;
        }

        .ws-help-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .ws-help-input {
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
          width: 300px;
          transition: border-color 0.18s;
        }

        .ws-help-input:focus { border-color: #1a73e8; }

        .ws-help-send {
          width: 40px;
          height: 40px;
          background: #1a73e8;
          color: #fff;
          border: none;
          border-radius: 50%;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.18s;
        }

        .ws-help-send:hover { background: #1557b0; }

        /* ── Start CTA (no sessions yet) ── */
        .ws-start-cta {
          background: #fff;
          border: 1.5px dashed #cbd5e1;
          border-radius: 14px;
          padding: 28px 24px;
          text-align: center;
          margin-bottom: 20px;
        }

        /* ── Desktop help bar: 30% | 30% | 40% ── */
        @media (min-width: 641px) {
          .ws-help-inner > img    { flex: 3 0 auto !important; }
          .ws-help-inner > div:nth-child(2) { flex: 3 1 0 !important; min-width: 0; }
          .ws-help-right-row      { flex: 4 1 0 !important; }
          .ws-help-input          { flex: 1 !important; width: auto !important; min-width: 0; }
        }

        /* ── Tablet: hide robot column, shrink LP ── */
        @media (max-width: 1100px) {
          .ws-cl-body { grid-template-columns: 40% 35% 25%; }
          .ws-cl-robot-col { display: none; }
          .ws-help-input { width: 220px; }
        }

        /* ── Tablet narrow / large mobile ── */
        @media (max-width: 900px) {
          .ws-cl-body { grid-template-columns: 1fr 180px; }
          .ws-cl-robot-col { display: none; }
          .ws-cl-lp-box { display: none; }
          .ws-cl-actions { min-width: unset; }

          .ws-rec-row { grid-template-columns: 1fr; }
          .ws-subj-grid { grid-template-columns: 1fr 1fr; }

          /* rec card: button drops below */
          .ws-rec-card { flex-wrap: wrap; }
          .ws-rec-right { width: 100%; flex-direction: row; align-items: center; justify-content: flex-start; margin-top: 4px; }

          /* banner: contain height */
          .ws-promo-banner { max-height: 200px; object-fit: cover; width: 100%; border-radius: 16px; }
        }

        /* ── Tablet: truncate title ── */
        @media (max-width: 900px) {
          .ws-cl-topic {
            font-size: 16px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }

        /* ── Mobile ── */
        @media (max-width: 640px) {
          .ws-cl-body { grid-template-columns: 1fr; }
          .ws-cl-robot-col { display: none; }
          .ws-cl-lp-box { display: none; }
          .ws-cl-actions { min-width: unset; width: 100%; }
          .ws-cl-topic { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .ws-cl-prog-mins { display: none; }

          .ws-subj-grid { grid-template-columns: 1fr; }

          /* help bar: robot + content always in a row, input below */
          .ws-help-inner { flex-wrap: nowrap; align-items: flex-start; gap: 10px; }
          .ws-help-inner > img { width: 68px !important; height: 68px !important; flex-shrink: 0; }
          .ws-help-inner > div:nth-child(2) { flex: 1; min-width: 0; }
          .ws-help-right-row { width: 100%; flex-shrink: unset; }
          .ws-help-input { width: calc(100% - 56px); }
          .ws-help-bar { padding: 14px 14px 10px !important; }
          .ws-help-strip { padding-left: 0 !important; gap: 12px !important; }
        }
      `}</style>

      <div className="ws-root">

        {/* ── Section 1: Active Sessions / Continue Learning / Start CTA ── */}
        {activeSessions.length > 0 ? (
          <>
          {activeSessions.slice(0, 1).map((session) => {
            const startTime = session.session_started_at
              ? new Date(session.session_started_at).getTime()
              : null;
            const pausedSecs = session.total_paused_seconds ?? 0;
            // When paused, active time stopped at paused_at — using Date.now() would
            // count the current pause duration as elapsed active time.
            const isPaused = session.status === "paused";
            const referenceTime =
              isPaused && session.paused_at
                ? new Date(session.paused_at).getTime()
                : Date.now();
            const elapsedSecs = startTime
              ? Math.max(0, (referenceTime - startTime) / 1000 - pausedSecs)
              : 0;
            const elapsedMins = Math.round(elapsedSecs / 60);
            const progressPct =
              session.duration_minutes > 0
                ? Math.min(100, Math.round((elapsedMins / session.duration_minutes) * 100))
                : 0;
            const summary = sessionSummaries[session.id];
            const minsRemaining = session.duration_minutes > 0
              ? Math.max(0, session.duration_minutes - elapsedMins)
              : null;
            const isOvertime = session.duration_minutes > 0 && elapsedMins > session.duration_minutes;
            const scheduledDate = session.scheduled_at
              ? new Date(session.scheduled_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
              : null;
            return (
              <div key={session.id} className="ws-cl-card" style={{ marginBottom: 16 }}>
                <span className="ws-cl-badge" style={{ ...(isPaused ? { background: "#fef3c7", color: "#b45309" } : {}) }}>
                  {isPaused ? "⏸ Paused" : "▶ Continue Learning"}
                </span>
                <div className="ws-cl-body">
                  {/* Col 1 — Session info */}
                  <div className="ws-cl-info">
                    <h2 className="ws-cl-topic">{session.title}</h2>
                    <p className="ws-cl-subject">
                      {session.subject} · {session.key_stage}
                    </p>
                    <div className="ws-cl-meta-row">
                      {session.duration_minutes > 0 && (
                        <span className="ws-cl-meta-pill">⏱ {session.duration_minutes} min session</span>
                      )}
                      {minsRemaining !== null && (
                        <span className="ws-cl-meta-pill" style={isOvertime ? { background: "#fee2e2", color: "#dc2626", borderColor: "#fecaca" } : { background: "#f0fdf4", color: "#16a34a", borderColor: "#bbf7d0" }}>
                          {isOvertime ? "⚠ Overtime" : `⏳ ${minsRemaining} min${minsRemaining !== 1 ? "s" : ""} left`}
                        </span>
                      )}
                      {session.teacher_name && (
                        <span className="ws-cl-meta-pill">👤 {session.teacher_name}</span>
                      )}
                      {scheduledDate && (
                        <span className="ws-cl-meta-pill">📅 {scheduledDate}</span>
                      )}
                    </div>
                    <div className="ws-cl-prog-row">
                      <div className="ws-cl-prog-top">
                        <span className="ws-cl-prog-label">
                          You're <strong style={{ color: "#1a73e8" }}>{progressPct > 0 ? `${progressPct}%` : "0%"}</strong> through this lesson
                        </span>
                      </div>
                      <div className="ws-cl-prog-track">
                        <div className="ws-cl-prog-fill" style={{ width: `${Math.max(progressPct, 2)}%` }} />
                      </div>
                    </div>
                    {summary && summary.messageCount > 0 && (
                      <div className="ws-cl-stats-strip">
                        <span className="ws-cl-stat">💬 {summary.messageCount} messages</span>
                        {summary.userTurns > 0 && <span className="ws-cl-stat">✏️ {summary.userTurns} responses</span>}
                        {summary.quizCount > 0 && <span className="ws-cl-stat">🎯 {summary.quizCount} quiz attempt{summary.quizCount > 1 ? "s" : ""}</span>}
                      </div>
                    )}
                  </div>

                  {/* Col 2 — Last Learning Point */}
                  <div className="ws-cl-lp-box">
                    <div className="ws-cl-lp-label">💬 Last Learning Point</div>
                    <div className="ws-cl-lp-msg">
                      {summary?.lastAiSnippet
                        ? `"${summary.lastAiSnippet}${summary.lastAiSnippet.length >= 120 ? "…" : ""}"`
                        : session.description
                          ? `"${session.description}"`
                          : "No messages yet — resume to continue your lesson."}
                    </div>
                  </div>

                  {/* Col 3 — Robot image */}
                  <div className="ws-cl-robot-col" style={{ overflow: "hidden" }}>
                    <img
                      src="/images/robot-resume.png"
                      alt=""
                      draggable={false}
                      aria-hidden="true"
                      style={{ width: "100%", height: "auto", objectFit: "contain", opacity: 1 }}
                    />
                  </div>

                  {/* Col 4 — Action buttons */}
                  <div className="ws-cl-actions">
                    <button className="ws-cl-btn-primary" onClick={() => navigate(`/session/${session.id}`)}>
                      ▶ Resume Lesson
                    </button>
                    <button className="ws-cl-btn-secondary" onClick={() => navigate("/lesson/setup")}>
                      Start a Different Topic
                    </button>
                    <button
                      className="ws-cl-btn-end"
                      onClick={async () => {
                        if (!window.confirm("End this lesson?")) return;
                        try {
                          await appointmentsApi.updateStatus(session.id, "completed");
                          load();
                        } catch { /* ignore */ }
                      }}
                    >
                      End Lesson
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => navigate("/sessions")}
            style={{
              display: "block", width: "100%", padding: "10px 0",
              background: "#f8fafc", border: "1.5px solid #e2e8f0",
              borderRadius: 10, fontSize: 13, fontWeight: 700,
              color: "#1a73e8", cursor: "pointer", fontFamily: "inherit",
              marginBottom: 20, transition: "background 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#eff6ff")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8fafc")}
          >
            View all sessions →
          </button>
          </>
        ) : continue_learning ? (
          <div className="ws-cl-card" style={{ position: "relative", overflow: "hidden" }}>
            <img
              src="/images/robot-resume.png"
              alt=""
              draggable={false}
              aria-hidden="true"
              style={{
                position: "absolute", right: 175, top: "50%", transform: "translateY(-50%)",
                width: 200, height: "auto", objectFit: "contain",
                opacity: 0.55, pointerEvents: "none", zIndex: 0,
              }}
            />
            <span className="ws-cl-badge" style={{ position: "relative", zIndex: 1 }}>Continue Learning</span>
            <div className="ws-cl-body" style={{ position: "relative", zIndex: 1 }}>
              <div className="ws-cl-info">
                <h2 className="ws-cl-topic">{continue_learning.topic}</h2>
                <p className="ws-cl-subject">
                  {continue_learning.subject} · {continue_learning.key_stage}
                </p>
                <div className="ws-cl-prog-row">
                  <div className="ws-cl-prog-top">
                    <span className="ws-cl-prog-label">
                      You're <strong style={{ color: "#1a73e8" }}>{continue_learning.mastery > 0 ? `${continue_learning.mastery}%` : "0%"}</strong> through this lesson
                    </span>
                  </div>
                  <div className="ws-cl-prog-track">
                    <div className="ws-cl-prog-fill" style={{ width: `${Math.max(continue_learning.mastery, 2)}%` }} />
                  </div>
                </div>
                {continue_learning.last_mistake && (
                  <div className="ws-cl-last-msg">
                    💬 {continue_learning.last_mistake}
                  </div>
                )}
              </div>
              <div className="ws-cl-actions">
                <button
                  className="ws-cl-btn-primary"
                  onClick={() => navigate("/lesson/setup")}
                >
                  ▶ Resume Lesson
                </button>
                <button
                  className="ws-cl-btn-secondary"
                  onClick={() => navigate("/lesson/setup")}
                >
                  View Last Message
                </button>
                <button
                  className="ws-cl-btn-secondary"
                  onClick={() => navigate("/lesson/setup")}
                >
                  Start a Different Topic
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
            <button
              className="ws-btn ws-btn--orange"
              onClick={() => navigate("/lesson/setup")}
            >
              Browse All Subjects →
            </button>
          </div>
        )}

        {/* ── Section 2: Recommended for You ── */}
        <div className="ws-rec-row">
          {/* Left column */}
          <div>
            <h3 className="ws-rec-left-header" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#1a73e8" }}>✦</span> Recommended for You
            </h3>

            {pendingAssignments.length > 0 && (
              <div className="ws-rec-card">
                <div className="ws-rec-icon-bubble">📋</div>
                <div className="ws-rec-body">
                  <span className="ws-rec-label" style={{ color: "#1a73e8", background: "#eff6ff" }}>
                    Teacher Assigned
                  </span>
                  <p className="ws-rec-title">
                    Homework: {pendingAssignments[0].homework.subject} — {pendingAssignments[0].homework.title}
                  </p>
                  <p className="ws-rec-desc">
                    Complete this assignment set by your teacher
                  </p>
                </div>
                <div className="ws-rec-right">
                  {pendingAssignments[0].homework.estimated_minutes && (
                    <span className="ws-rec-mins">{pendingAssignments[0].homework.estimated_minutes} mins</span>
                  )}
                  <button
                    className="ws-rec-start-btn"
                    style={{ background: "#1a73e8" }}
                    onClick={() =>
                      navigate("/lesson/setup", {
                        state: { subject: pendingAssignments[0].homework.subject },
                      })
                    }
                  >
                    Start Session
                  </button>
                </div>
              </div>
            )}

            {daily_plan.weak_spots.length > 0 && (
              <div className="ws-rec-card">
                <div className="ws-rec-icon-bubble">
                  <img src="/images/robot-happy.png" style={{ width: 40, height: 40, objectFit: "contain" }} alt="Start Learning" />
                </div>
                <div className="ws-rec-body">
                  <span className="ws-rec-label" style={{ color: "#7c3aed", background: "#f5f3ff" }}>
                    Recommended Learning
                  </span>
                  <p className="ws-rec-title">
                    Improve in {daily_plan.weak_spots[0].subject} — {daily_plan.weak_spots[0].topic}
                  </p>
                  <p className="ws-rec-desc">
                    Based on your recent performance, we recommend practising this topic.
                  </p>
                </div>
                <div className="ws-rec-right">
                  <span className="ws-rec-mins">40 Minutes</span>
                  <button
                    className="ws-rec-start-btn"
                    style={{ background: "#7c3aed" }}
                    onClick={() =>
                      navigate("/lesson/setup", {
                        state: { subject: daily_plan.weak_spots[0].subject },
                      })
                    }
                  >
                    Start Session
                  </button>
                </div>
              </div>
            )}

            {pendingAssignments.length === 0 && daily_plan.weak_spots.length === 0 && (
              <div className="ws-rec-card" style={{ borderLeft: "3px solid #1a73e8", paddingLeft: 14 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 12,
                  background: "#eff6ff", border: "1px solid #bfdbfe",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, overflow: "hidden",
                }}>
                  <img src="/images/robot-happy.png" alt="AI Tutor" draggable={false}
                    style={{ width: 40, height: 40, objectFit: "contain" }} />
                </div>
                <div className="ws-rec-body">
                  <span className="ws-rec-label" style={{ color: "#1a73e8", background: "#eff6ff", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "#1a73e8" }}>✦</span> Keep Learning
                  </span>
                  <p className="ws-rec-title">Explore a new topic today</p>
                  <p className="ws-rec-desc">Pick any subject and continue learning at your own pace.</p>
                </div>
                <div className="ws-rec-right">
                  <button
                    className="ws-rec-start-btn"
                    style={{ background: "#1a73e8" }}
                    onClick={() => navigate("/lesson/setup")}
                  >
                    Start Session
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right column — promo banner image */}
          <div style={{ borderRadius: 16, overflow: "hidden", height: "100%", minHeight: 180 }}>
            <img
              src="/images/banner.jpeg"
              alt="Smart Tuition"
              draggable={false}
              className="ws-promo-banner"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        </div>

        {/* ── Section 3: Pick a Subject & Tutor ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>Pick a Subject & Tutor</h3>
            <button
              onClick={() => navigate("/lesson/setup")}
              style={{ fontSize: 12, fontWeight: 600, color: "#1a73e8", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              View all subjects →
            </button>
          </div>
          <div className="ws-subj-grid">
            {[
              {
                name: "Maths",
                desc: "Build confidence and solve problems, step by step",
                bg: "#f0fdf4",
                border: "#bbf7d0",
                btnBg: "#22c55e",
                img: "/images/session-robot-green.png",
              },
              {
                name: "Science",
                desc: "Explore ideas and understand how the world works",
                bg: "#eff6ff",
                border: "#bfdbfe",
                btnBg: "#1a73e8",
                img: "/images/session-robot-blue.png",
              },
              {
                name: "English",
                desc: "Improve your reading, writing and communication",
                bg: "#fff7ed",
                border: "#fed7aa",
                btnBg: "#f97316",
                img: "/images/session-robot-org.png",
              },
            ].map((s) => (
              <div
                key={s.name}
                className="ws-subj-card"
                style={{ background: s.bg, border: `1.5px solid ${s.border}` }}
                onClick={() => navigate("/lesson/setup", { state: { subject: s.name } })}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px rgba(0,0,0,0.12)`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                }}
              >
                <img
                  src={s.img}
                  alt={s.name}
                  draggable={false}
                  className="ws-subj-img"
                  style={{}}
                />
                <span className="ws-subj-name">{s.name}</span>
                <span className="ws-subj-desc">{s.desc}</span>
                <button
                  className="ws-subj-btn"
                  style={{ background: s.btnBg }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate("/lesson/setup", { state: { subject: s.name } });
                  }}
                >
                  Choose {s.name} →
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 4: Need Help Bar — 30% | 30% | 40% ── */}
        <div className="ws-help-bar" style={{ padding: 0, gap: 0, overflow: "hidden", position: "relative", alignItems: "stretch" }}>

          {/* 24/7 AI Support badge — absolute top-right */}
          <span style={{
            position: "absolute", top: 12, right: 16, zIndex: 2,
            fontSize: 10, fontWeight: 700, color: "#16a34a",
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            padding: "2px 8px", borderRadius: 99,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", display: "inline-block", flexShrink: 0 }} />
            24/7 AI Support
          </span>

          {/* Col 1 — 30% — robot background */}
          <div style={{
            flex: 3,
            backgroundImage: "url('/images/robot-help.png')",
            backgroundSize: "contain",
            backgroundPosition: "center bottom",
            backgroundRepeat: "no-repeat",
            minHeight: 130,
          }} />

          {/* Col 2 — 30% — heading + subtitle + scrolling chips */}
          <div style={{ flex: 3, padding: "16px 16px 14px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
            <p className="ws-help-text-heading" style={{ margin: "0 0 2px" }}>Need help with something?</p>
            <p className="ws-help-text-sub" style={{ marginBottom: 10 }}>Ask me anything about your studies</p>
            {/* Scrolling chips ticker */}
            <div style={{ overflow: "hidden", width: "100%" }}>
              <div className="ws-chips-track">
                {[...["GCSE Maths", "Homework Help", "Science Revision", "Ask AI Tutor"],
                  ...["GCSE Maths", "Homework Help", "Science Revision", "Ask AI Tutor"]].map((chip, i) => (
                  <button
                    key={`${chip}-${i}`}
                    type="button"
                    onClick={() => onPromptClick(chip)}
                    style={{
                      padding: "3px 10px", fontSize: 11, fontWeight: 600,
                      background: "#f8fafc", border: "1px solid #e2e8f0",
                      borderRadius: 99, cursor: "pointer", color: "#475569",
                      fontFamily: "inherit", transition: "background 0.15s", whiteSpace: "nowrap", flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#bfdbfe"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0"; }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Col 3 — 40% — input + send + strip */}
          <div className="ws-help-right-col" style={{ flex: 4, padding: "16px 16px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
            <div className="ws-help-right-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                ref={helpInputRef}
                className="ws-help-input"
                placeholder="Type your question..."
                value={helpInput}
                onChange={(e) => setHelpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && helpInput.trim()) {
                    onPromptClick(helpInput.trim());
                    setHelpInput("");
                  }
                }}
              />
              <button
                className="ws-help-send"
                onClick={() => {
                  if (helpInput.trim()) {
                    onPromptClick(helpInput.trim());
                    setHelpInput("");
                  }
                }}
              >
                ➤
              </button>
            </div>
            <div className="ws-help-strip" style={{
              display: "flex", alignItems: "center", gap: 12,
              fontSize: 10.5, color: "#94a3b8", flexWrap: "wrap",
            }}>
              <span style={{ whiteSpace: "nowrap" }}>📍 Instant Answers</span>
              <span style={{ whiteSpace: "nowrap" }}>📚 Curriculum Aligned</span>
              <span style={{ whiteSpace: "nowrap" }}>⚡ Powered by Smart AI</span>
            </div>
          </div>

        </div>

      </div>
    </>
  );
}
