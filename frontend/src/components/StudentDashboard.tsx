import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { gamificationApi } from "../services/api";
import type { DashboardData } from "../types";

interface Props {
  onStartChat: (topic?: string) => void;
  onNavigate: (path: string) => void;
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

const XP_PER_LEVEL = 500;

function XpBar({ current, toNext, level }: { current: number; toNext: number; level: number }) {
  const total = XP_PER_LEVEL;
  const earned = total - toNext;
  const pct = Math.min(100, Math.max(0, (earned / total) * 100));
  return (
    <div className="xp-bar-wrapper">
      <div className="xp-bar-labels">
        <span className="xp-bar-left">
          <span className="xp-star">★</span> {current.toLocaleString()} XP
        </span>
        <span className="xp-bar-right">Level {level}</span>
      </div>
      <div className="xp-bar">
        <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="xp-bar-sublabel">{toNext} XP to Level {level + 1}</div>
    </div>
  );
}

function MasteryBadge({ level }: { level: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_started: { label: "Not started", cls: "mastery-ns" },
    learning: { label: "Learning", cls: "mastery-learning" },
    practicing: { label: "Practicing", cls: "mastery-practicing" },
    mastered: { label: "Mastered", cls: "mastery-mastered" },
  };
  const m = map[level] ?? { label: level, cls: "mastery-ns" };
  return <span className={`mastery-badge ${m.cls}`}>{m.label}</span>;
}

function MasteryBar({ pct }: { pct: number }) {
  const clamp = Math.min(100, Math.max(0, pct));
  const color =
    clamp >= 80 ? "var(--success)" : clamp >= 50 ? "var(--accent)" : clamp >= 20 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="mastery-bar">
      <div className="mastery-bar-fill" style={{ width: `${clamp}%`, background: color }} />
    </div>
  );
}

export default function StudentDashboard({ onStartChat, onNavigate }: Props) {
  const { user } = useAuth();
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

  if (loading) {
    return (
      <div className="student-dashboard student-dashboard--loading">
        <div className="sd-spinner" />
        <p>Loading your dashboard…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="student-dashboard student-dashboard--error">
        <div className="sd-error-icon">⚠</div>
        <p>{error ?? "No data available."}</p>
        <button className="sd-btn sd-btn--primary" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const { profile, daily_plan, continue_learning, xp_to_next_level, mastery_overview } = data;
  const firstName = user?.name?.split(" ")[0] ?? "there";

  const masteryPct = (level: string) => {
    const m: Record<string, number> = { not_started: 0, learning: 25, practicing: 60, mastered: 100 };
    return m[level] ?? 0;
  };

  return (
    <div className="student-dashboard">
      {/* ── Hero header ── */}
      <header className="sd-header">
        <div className="sd-header-left">
          <h1 className="sd-greeting">
            {getGreeting()}, <span className="sd-name">{firstName}</span> 👋
          </h1>
          <p className="sd-subline">Ready to level up today?</p>
        </div>
        <div className="sd-header-right">
          {/* Streak */}
          <div className="streak-badge">
            <span className="streak-fire">🔥</span>
            <div className="streak-info">
              <span className="streak-count">{profile.current_streak}</span>
              <span className="streak-label">day streak</span>
            </div>
            {profile.current_streak > 0 && (
              <span className="streak-sub">Keep it up!</span>
            )}
          </div>
          {/* XP bar */}
          <XpBar current={profile.xp_total} toNext={xp_to_next_level} level={profile.xp_level} />
        </div>
      </header>

      {/* ── Body grid ── */}
      <div className="sd-body">
        {/* LEFT column */}
        <div className="sd-col-main">
          {/* Continue learning card */}
          {continue_learning ? (
            <section className="sd-card sd-continue-card">
              <div className="sd-card-tag sd-tag--continue">Continue Learning</div>
              <div className="sd-continue-body">
                <div className="sd-continue-info">
                  <h2 className="sd-continue-topic">{continue_learning.topic}</h2>
                  <p className="sd-continue-subject">
                    {continue_learning.subject} · {continue_learning.key_stage}
                  </p>
                  {continue_learning.last_mistake && (
                    <p className="sd-continue-mistake">
                      <span className="sd-mistake-label">Last difficulty:</span>{" "}
                      {continue_learning.last_mistake}
                    </p>
                  )}
                  <div className="sd-continue-progress">
                    <span className="sd-progress-label">Mastery</span>
                    <MasteryBar pct={continue_learning.mastery} />
                    <span className="sd-progress-pct">{continue_learning.mastery}%</span>
                  </div>
                </div>
                <div className="sd-continue-actions">
                  <button
                    className="sd-btn sd-btn--primary"
                    onClick={() =>
                      onStartChat(
                        `Let's continue where we left off. Topic: ${continue_learning.topic} (${continue_learning.subject}, ${continue_learning.key_stage})`
                      )
                    }
                  >
                    ▶ Resume Lesson
                  </button>
                  <button
                    className="sd-btn sd-btn--ghost"
                    onClick={() =>
                      onStartChat(
                        `I'd like to study a different topic in ${continue_learning.subject} for ${continue_learning.key_stage}.`
                      )
                    }
                  >
                    Different Topic
                  </button>
                  <button
                    className="sd-btn sd-btn--outline"
                    onClick={() =>
                      onStartChat(
                        `Quiz me on ${continue_learning.topic} (${continue_learning.subject}).`
                      )
                    }
                  >
                    ⚡ Quick Quiz
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="sd-card sd-start-card">
              <div className="sd-start-inner">
                <div className="sd-start-icon">🚀</div>
                <h2>Start your first lesson</h2>
                <p>Pick any topic and your AI tutor will personalise it for you.</p>
                <button
                  className="sd-btn sd-btn--primary"
                  onClick={() => onStartChat()}
                >
                  Begin Learning
                </button>
              </div>
            </section>
          )}

          {/* Mastery overview */}
          {mastery_overview.length > 0 && (
            <section className="sd-card">
              <h3 className="sd-section-title">Your Progress</h3>
              <div className="sd-mastery-list">
                {mastery_overview.slice(0, 6).map((m) => (
                  <div key={m.id} className="sd-mastery-row">
                    <div className="sd-mastery-meta">
                      <span className="sd-mastery-topic">{m.topic}</span>
                      <span className="sd-mastery-subject">{m.subject}</span>
                    </div>
                    <div className="sd-mastery-right">
                      <MasteryBar pct={masteryPct(m.mastery_level)} />
                      <MasteryBadge level={m.mastery_level} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT column – Today's Plan */}
        <div className="sd-col-side">
          <section className="sd-card sd-plan-card">
            <h3 className="sd-section-title">Today's Plan</h3>

            {daily_plan.weak_spots.length === 0 &&
              daily_plan.spaced_review.length === 0 &&
              daily_plan.confidence_boost.length === 0 && (
                <p className="sd-empty-plan">
                  No recommendations yet. Complete a lesson to unlock your personalised plan.
                </p>
              )}

            {daily_plan.weak_spots.map((ws, i) => (
              <div
                key={i}
                className="daily-plan-card daily-plan-card--weak"
                onClick={() =>
                  onStartChat(
                    `I need help improving on ${ws.topic} in ${ws.subject}. Please teach me with targeted questions.`
                  )
                }
              >
                <span className="dpc-icon">🔧</span>
                <div className="dpc-body">
                  <p className="dpc-topic">{ws.topic}</p>
                  <p className="dpc-action">Start 5-question repair set</p>
                </div>
                <span className="dpc-arrow">›</span>
              </div>
            ))}

            {daily_plan.spaced_review.map((sr, i) => (
              <div
                key={i}
                className="daily-plan-card daily-plan-card--review"
                onClick={() =>
                  onStartChat(
                    `Let's do a spaced-repetition review of ${sr.topic} in ${sr.subject}.`
                  )
                }
              >
                <span className="dpc-icon">📅</span>
                <div className="dpc-body">
                  <p className="dpc-topic">{sr.topic}</p>
                  <p className="dpc-action">
                    Last practiced {sr.days_since} day{sr.days_since !== 1 ? "s" : ""} ago
                  </p>
                </div>
                <span className="dpc-arrow">›</span>
              </div>
            ))}

            {daily_plan.confidence_boost.map((cb, i) => (
              <div
                key={i}
                className="daily-plan-card daily-plan-card--boost"
                onClick={() =>
                  onStartChat(
                    `Let's build confidence on ${cb.topic} in ${cb.subject}. Quiz me on it.`
                  )
                }
              >
                <span className="dpc-icon">⚡</span>
                <div className="dpc-body">
                  <p className="dpc-topic">{cb.topic}</p>
                  <p className="dpc-action">Build momentum</p>
                </div>
                <span className="dpc-arrow">›</span>
              </div>
            ))}
          </section>

          {/* Upcoming sessions */}
          {daily_plan.upcoming_sessions.length > 0 && (
            <section className="sd-card sd-upcoming-card">
              <h3 className="sd-section-title">Upcoming Sessions</h3>
              {daily_plan.upcoming_sessions.slice(0, 3).map((s) => (
                <div key={s.id} className="sd-session-row">
                  <div className="sd-session-dot" />
                  <div className="sd-session-info">
                    <p className="sd-session-title">{s.title}</p>
                    <p className="sd-session-meta">
                      {s.subject} · {formatDate(s.scheduled_at)}
                    </p>
                  </div>
                  <button
                    className="sd-btn sd-btn--xs"
                    onClick={() => onNavigate(`/session/${s.id}`)}
                  >
                    Join
                  </button>
                </div>
              ))}
            </section>
          )}

          {/* Quick actions */}
          <section className="sd-card sd-quick-card">
            <h3 className="sd-section-title">Quick Actions</h3>
            <div className="sd-quick-grid">
              <button
                className="sd-quick-btn"
                onClick={() => onStartChat("Let's start a new topic. What subjects do you have materials for?")}
              >
                <span>📚</span>New Topic
              </button>
              <button
                className="sd-quick-btn"
                onClick={() => onStartChat("Can you quiz me on something I haven't practised recently?")}
              >
                <span>🎯</span>Quiz Me
              </button>
              <button
                className="sd-quick-btn"
                onClick={() => onNavigate("/appointments")}
              >
                <span>🗓</span>Book Session
              </button>
              <button
                className="sd-quick-btn"
                onClick={() => onStartChat("Give me a summary of my progress so far and what I should focus on.")}
              >
                <span>📈</span>My Progress
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
