import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gamificationApi } from "../services/api";
import type { DashboardData } from "../types";

interface Props {
  onPromptClick: (text: string) => void;
}

const SUBJECTS = [
  { emoji: "🔢", label: "Maths" },
  { emoji: "🔬", label: "Science" },
  { emoji: "📖", label: "English" },
  { emoji: "🏛️", label: "History" },
  { emoji: "🌍", label: "Geography" },
  { emoji: "➕", label: "More" },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const XP_PER_LEVEL = 500;

export default function WelcomeScreen({ onPromptClick }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = (await gamificationApi.getDashboard()) as DashboardData;
      setData(d);
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

  if (error || !data) {
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

  const { profile, daily_plan, continue_learning, xp_to_next_level } = data;

  const xpEarned = XP_PER_LEVEL - xp_to_next_level;
  const xpPct = Math.min(100, Math.max(0, (xpEarned / XP_PER_LEVEL) * 100));

  const weakSpots = daily_plan.weak_spots.slice(0, 2);

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

        .ws-loading,
        .ws-error {
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

        /* ── Greeting banner ── */
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

        .ws-greeting-left h1 span {
          color: #1a73e8;
        }

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

        .ws-stat-chip .ws-chip-icon {
          font-size: 16px;
        }

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

        /* ── Two-column lower grid ── */
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

        .ws-plan-item:last-child {
          margin-bottom: 0;
        }

        .ws-plan-item--weak {
          border-left-color: #ef4444;
          background: #fff5f5;
        }

        .ws-plan-item--weak:hover { background: #fee2e2; }

        .ws-plan-item--review {
          border-left-color: #3b82f6;
          background: #f0f6ff;
        }

        .ws-plan-item--review:hover { background: #dbeafe; }

        .ws-plan-item--boost {
          border-left-color: #22c55e;
          background: #f0faf4;
        }

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

        /* ── Recommended cards ── */
        .ws-rec-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 20px;
        }

        .ws-rec-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }

        .ws-rec-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #1a73e8;
          flex-shrink: 0;
        }

        .ws-rec-info {
          flex: 1;
          min-width: 0;
        }

        .ws-rec-topic {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ws-rec-meta {
          font-size: 12px;
          color: #64748b;
          margin: 0;
        }

        /* ── Subject grid ── */
        .ws-subjects-section {
          margin-bottom: 20px;
        }

        .ws-subjects-title {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #94a3b8;
          margin-bottom: 12px;
        }

        .ws-subjects-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .ws-subject-chip {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 16px;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
          font-family: inherit;
        }

        .ws-subject-chip:hover {
          border-color: #1a73e8;
          background: #eff6ff;
          box-shadow: 0 2px 8px rgba(26,115,232,0.1);
        }

        .ws-subject-icon { font-size: 18px; }

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

        .ws-btn--primary {
          background: #3b82f6;
          color: #fff;
        }

        .ws-btn--primary:hover {
          background: #2563eb;
        }

        .ws-btn--orange {
          background: #1a73e8;
          color: #fff;
          box-shadow: 0 2px 10px rgba(26,115,232,0.3);
        }

        .ws-btn--orange:hover {
          background: #1557b0;
          opacity: 1;
        }

        .ws-btn--ghost {
          background: #f1f5f9;
          color: #374151;
          border: 1px solid #e2e8f0;
        }

        .ws-btn--ghost:hover {
          background: #e2e8f0;
        }

        .ws-btn--outline {
          background: transparent;
          color: #3b82f6;
          border: 1.5px solid #3b82f6;
        }

        .ws-btn--outline:hover {
          background: #eff6ff;
        }

        .ws-btn--sm {
          padding: 7px 12px;
          font-size: 12px;
        }

        /* Responsive */
        @media (max-width: 720px) {
          .ws-grid {
            grid-template-columns: 1fr;
          }

          .ws-continue-actions {
            flex-direction: row;
            flex-wrap: wrap;
            min-width: unset;
            width: 100%;
          }

          .ws-greeting-banner {
            flex-direction: column;
            align-items: flex-start;
          }
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
                    <div className="ws-prog-fill" style={{ width: `${continue_learning.mastery}%` }} />
                  </div>
                  <span className="ws-prog-pct">{continue_learning.mastery}% complete</span>
                </div>
                {continue_learning.last_mistake && (
                  <p className="ws-continue-last">
                    Last message: "{continue_learning.last_mistake}"
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

        {/* Two-column: Today's Plan + Quick Actions */}
        <div className="ws-grid">
          <div className="ws-card">
            <div className="ws-card-title">Today's Plan</div>

            {daily_plan.weak_spots.length === 0 &&
              daily_plan.spaced_review.length === 0 &&
              daily_plan.confidence_boost.length === 0 && (
                <p className="ws-empty-plan">
                  No recommendations yet. Complete a lesson to unlock your personalised plan.
                </p>
              )}

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
                  <p className="ws-plan-sub">Start 5-question repair set</p>
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
                    Last practised {sr.days_since} day{sr.days_since !== 1 ? "s" : ""} ago
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
                  <p className="ws-plan-sub">Build momentum</p>
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
                onClick={() => navigate("/lesson/setup")}
              >
                <span className="ws-q-icon">🎯</span>
                New Topic
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
                Quiz Me
              </button>
              <button
                className="ws-quick-btn"
                onClick={() => navigate("/appointments")}
              >
                <span className="ws-q-icon">📖</span>
                Book Session
              </button>
              <button
                className="ws-quick-btn"
                onClick={() => navigate("/progress")}
              >
                <span className="ws-q-icon">📊</span>
                My Reports
              </button>
            </div>
          </div>
        </div>

        {/* Recommended for You (weak spots) */}
        {weakSpots.length > 0 && (
          <>
            <div className="ws-card-title" style={{ marginBottom: 10 }}>
              Recommended for You
            </div>
            <div className="ws-rec-list">
              {weakSpots.map((ws, i) => (
                <div className="ws-rec-card" key={i}>
                  <div className="ws-rec-dot" />
                  <div className="ws-rec-info">
                    <p className="ws-rec-topic">{ws.topic}</p>
                    <p className="ws-rec-meta">
                      {ws.subject} · Needs attention · ~{i === 0 ? "1hr" : "30m"}
                    </p>
                  </div>
                  <button
                    className="ws-btn ws-btn--primary ws-btn--sm"
                    onClick={() =>
                      onPromptClick(
                        `Let's work on ${ws.topic} in ${ws.subject}. Please start a session on this topic.`
                      )
                    }
                  >
                    Start Session →
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Upcoming sessions */}
        {daily_plan.upcoming_sessions.length > 0 && (
          <>
            <div className="ws-card-title" style={{ marginBottom: 10 }}>
              Upcoming AI Sessions
            </div>
            <div className="ws-rec-list">
              {daily_plan.upcoming_sessions.slice(0, 3).map((s) => (
                <div className="ws-rec-card" key={s.id}>
                  <div className="ws-rec-dot" style={{ background: "#22c55e" }} />
                  <div className="ws-rec-info">
                    <p className="ws-rec-topic">{s.title}</p>
                    <p className="ws-rec-meta">
                      {s.subject} · {formatSessionDate(s.scheduled_at)}
                    </p>
                  </div>
                  <button
                    className="ws-btn ws-btn--ghost ws-btn--sm"
                    onClick={() => navigate(`/session/${s.id}`)}
                  >
                    Join →
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Pick a Subject */}
        <div className="ws-subjects-section">
          <div className="ws-subjects-title">Pick a Subject</div>
          <div className="ws-subjects-grid">
            {SUBJECTS.map((s) => (
              <button
                key={s.label}
                className="ws-subject-chip"
                onClick={() => {
                  if (s.label === "More") {
                    onPromptClick("What subjects do you have materials for?");
                  } else {
                    navigate(`/lesson/setup?subject=${encodeURIComponent(s.label)}`);
                  }
                }}
              >
                <span className="ws-subject-icon">{s.emoji}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
