import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { gamificationApi, assessmentsApi, appointmentsApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { TopicMastery, StudentProfile, Assessment, Appointment } from "../types";
import LottiePlayer, { LOTTIE_URLS } from "../components/LottiePlayer";

interface SubjectStats {
  subject: string;
  total: number;
  mastered: number;
  percent: number;
  needsFocus: boolean;
}

interface NextTopicRec {
  topic: string;
  subject: string;
  key_stage: string;
  preview: string;
}

function buildSubjectStats(mastery: TopicMastery[]): SubjectStats[] {
  const map: Record<string, { total: number; mastered: number }> = {};
  for (const m of mastery) {
    if (!map[m.subject]) map[m.subject] = { total: 0, mastered: 0 };
    map[m.subject].total += 1;
    if (m.mastery_level === "mastered" || m.mastery_level === "practicing") {
      map[m.subject].mastered += 1;
    }
  }
  return Object.entries(map)
    .map(([subject, v]) => ({
      subject,
      total: v.total,
      mastered: v.mastered,
      percent: v.total > 0 ? Math.round((v.mastered / v.total) * 100) : 0,
      needsFocus: v.total > 0 && v.mastered / v.total < 0.5,
    }))
    .sort((a, b) => b.percent - a.percent);
}

function formatStudyTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getTopicAvgScore(m: TopicMastery): number | null {
  if (!m.score_history || m.score_history.length === 0) return null;
  const scores = m.score_history.map((h) => h.score);
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function getTopicTrend(m: TopicMastery): "up" | "down" | "stable" {
  if (!m.score_history || m.score_history.length < 2) return "stable";
  const last = m.score_history[m.score_history.length - 1].score;
  const prev = m.score_history[m.score_history.length - 2].score;
  if (last > prev + 5) return "up";
  if (last < prev - 5) return "down";
  return "stable";
}

const trendIcon = { up: "↑", down: "↓", stable: "→" };
const trendColor = { up: "#16a34a", down: "#dc2626", stable: "#94a3b8" };

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div style={{ height: 8, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", flex: 1, minWidth: 80 }}>
      <div
        style={{
          height: "100%",
          width: `${Math.min(percent, 100)}%`,
          background: color,
          borderRadius: 999,
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
}

export default function ProgressPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [mastery, setMastery] = useState<TopicMastery[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [sessions, setSessions] = useState<Appointment[]>([]);
  const [nextTopics, setNextTopics] = useState<NextTopicRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const [estimatorHours, setEstimatorHours] = useState(5);

  useEffect(() => {
    const load = async () => {
      try {
        const [profileData, masteryData] = await Promise.all([
          gamificationApi.getProfile() as Promise<StudentProfile>,
          gamificationApi.getMastery() as Promise<TopicMastery[]>,
        ]);
        setProfile(profileData);
        setMastery(masteryData);

        await Promise.allSettled([
          user
            ? assessmentsApi.listForStudent(user.id).then((d) => setAssessments(d as Assessment[])).catch(() => {})
            : Promise.resolve(),
          appointmentsApi.list().then((d) => {
            const done = (d as Appointment[]).filter((a) => ["completed", "terminated"].includes(a.status));
            setSessions(done);
          }).catch(() => {}),
          (async () => {
            const primarySubject = masteryData.length > 0
              ? buildSubjectStats(masteryData)[0]?.subject
              : undefined;
            try {
              const result = await (gamificationApi as any).getNextTopics(primarySubject);
              if (result?.recommendations) setNextTopics(result.recommendations);
            } catch {
              // non-fatal
            }
          })(),
        ]);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const subjectStats = buildSubjectStats(mastery);
  const visibleSubjects = showAllSubjects ? subjectStats : subjectStats.slice(0, 5);

  const strengths = mastery
    .filter((m) => m.mastery_level === "mastered" || m.mastery_level === "practicing")
    .sort((a, b) => (getTopicAvgScore(b) ?? 0) - (getTopicAvgScore(a) ?? 0))
    .slice(0, 4);

  const focusAreas = mastery
    .filter((m) => m.mastery_level === "learning" || m.mastery_level === "not_started")
    .sort((a, b) => a.attempts - b.attempts)
    .slice(0, 4);

  const completedAssessments = assessments.filter((a) => a.status === "completed");

  const totalStudyMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const sessionsDone = sessions.length;
  const totalTopics = mastery.length;

  const totalQuestionsCorrect = completedAssessments.reduce((sum, a) => sum + (a.correct_answers ?? 0), 0);
  const totalQuestionsAttempted = completedAssessments.reduce((sum, a) => sum + (a.total_questions ?? 0), 0);
  const accuracyPercent =
    totalQuestionsAttempted > 0
      ? Math.round((totalQuestionsCorrect / totalQuestionsAttempted) * 100)
      : null;

  // Compute this Monday (start of current calendar week)
  const thisMonday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  })();

  // Weekly chart scores: 4 calendar weeks (Mon-Sun), index 0 = 3 weeks ago, index 3 = this week
  const weeklyScores: (number | null)[] = [3, 2, 1, 0].map((w) => {
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - w * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const weekAsm = completedAssessments.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    if (weekAsm.length === 0) return null;
    return Math.round(weekAsm.reduce((s, a) => s + (a.score_percent ?? 0), 0) / weekAsm.length);
  });

  // Human-readable labels for the 4 past weeks + 1 predicted next week
  const weekLabels: string[] = (() => {
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const labels = [3, 2, 1, 0].map((w) => {
      const d = new Date(thisMonday);
      d.setDate(d.getDate() - w * 7);
      return w === 0 ? "This wk" : fmt(d);
    });
    const nextMon = new Date(thisMonday);
    nextMon.setDate(nextMon.getDate() + 7);
    labels.push(fmt(nextMon));
    return labels;
  })();

  // Predicted next week score via linear extrapolation
  const nonZeroWeeks = weeklyScores
    .map((s, i) => ({ week: i, score: s }))
    .filter((x): x is { week: number; score: number } => x.score !== null && x.score > 0);

  let predictedNextWeek: number | null = null;
  if (nonZeroWeeks.length >= 2) {
    const last = nonZeroWeeks[nonZeroWeeks.length - 1].score;
    const prev = nonZeroWeeks[nonZeroWeeks.length - 2].score;
    predictedNextWeek = Math.max(5, Math.min(100, Math.round(last + (last - prev))));
  } else if (nonZeroWeeks.length === 1) {
    predictedNextWeek = nonZeroWeeks[0].score;
  }

  // Learning velocity: mastered topics / weeks active
  const masteredCount = mastery.filter((m) => m.mastery_level === "mastered").length;
  const activeTopics = mastery.filter((m) => m.last_practiced_at !== null);
  let learningVelocity = 0;
  if (activeTopics.length > 0 && masteredCount > 0) {
    const dates = activeTopics.map((m) => new Date(m.last_practiced_at!).getTime());
    const oldest = Math.min(...dates);
    const weeksActive = Math.max(1, (Date.now() - oldest) / (7 * 24 * 3600 * 1000));
    learningVelocity = Math.round((masteredCount / weeksActive) * 10) / 10;
  }

  const topicsRemaining = mastery.filter((m) => m.mastery_level !== "mastered").length;
  const completionWeeks = learningVelocity > 0 ? Math.ceil(topicsRemaining / learningVelocity) : null;

  const masteryTrend: "improving" | "declining" | "stable" = (() => {
    if (nonZeroWeeks.length < 2) return "stable";
    const diff = nonZeroWeeks[nonZeroWeeks.length - 1].score - nonZeroWeeks[nonZeroWeeks.length - 2].score;
    return diff > 5 ? "improving" : diff < -5 ? "declining" : "stable";
  })();

  const weakestSubject = subjectStats.find((s) => s.needsFocus)?.subject ?? "your weaker topics";

  // Progress estimator: estimate level gain from extra study hours
  const currentLevel = profile?.xp_level ?? 1;
  const currentXp = profile?.xp_total ?? 0;
  const xpPerHour = 45; // approx XP per hour of study
  const projectedXp = currentXp + estimatorHours * xpPerHour;
  const projectedLevel = Math.floor(projectedXp / 100) + 1;
  const levelsGained = Math.max(0, projectedLevel - currentLevel);
  const avgScoreOverall = mastery.length > 0
    ? Math.round(
        mastery.reduce((sum, m) => {
          const hist = m.score_history ?? [];
          const avg = hist.length > 0 ? hist.reduce((a, s) => a + s.score, 0) / hist.length : 0;
          return sum + avg;
        }, 0) / mastery.length
      )
    : 0;

  const achievements = [
    profile && profile.current_streak >= 5 ? { icon: "🔥", label: `${profile.current_streak}-day streak` } : null,
    profile && profile.xp_total >= 100 ? { icon: "⭐", label: `${profile.xp_total} XP` } : null,
    totalTopics >= 5 ? { icon: "📚", label: "Topic Explorer" } : null,
    completedAssessments.length >= 3 ? { icon: "⚡", label: `${completedAssessments.length} Quizzes Done` } : null,
  ].filter(Boolean) as { icon: string; label: string }[];

  if (loading) {
    return (
      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <div style={{ padding: "60px 0", textAlign: "center" }}>
            <div className="typing-indicator" style={{ justifyContent: "center" }}>
              <span /><span /><span />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div className="dashboard-page-header" style={{ marginBottom: 20 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>My Progress</h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>
                See how you're improving, see where to focus more.
              </p>
            </div>
          </div>

          {error && (
            <div style={{ padding: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { icon: "📚", value: formatStudyTime(totalStudyMinutes), label: "Total Study Time" },
              { icon: "✅", value: String(sessionsDone), label: "Sessions Done" },
              { icon: "❓", value: accuracyPercent !== null ? `${accuracyPercent}%` : "—", label: "Questions Correct" },
              { icon: "🗂️", value: String(totalTopics), label: "Topics Covered" },
            ].map((s) => (
              <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 2 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Forecast Metrics Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              {
                icon: "⚡",
                value: learningVelocity > 0 ? `${learningVelocity}/wk` : "—",
                label: "Learning Velocity",
                sub: "topics mastered per week",
                color: "#3b82f6",
              },
              {
                icon: masteryTrend === "improving" ? "📈" : masteryTrend === "declining" ? "📉" : "➡️",
                value: masteryTrend === "improving" ? "Improving" : masteryTrend === "declining" ? "Declining" : "Stable",
                label: "Quiz Score Trend",
                sub: "based on last 4 weeks",
                color: masteryTrend === "improving" ? "#16a34a" : masteryTrend === "declining" ? "#dc2626" : "#64748b",
              },
              {
                icon: "🎯",
                value: predictedNextWeek !== null ? `~${predictedNextWeek}%` : "—",
                label: "Predicted Next Week",
                sub: "projected quiz accuracy",
                color: "#8b5cf6",
              },
              {
                icon: "🏁",
                value: completionWeeks !== null ? `~${completionWeeks}w` : "—",
                label: "Est. Completion",
                sub: `${topicsRemaining} topics remaining`,
                color: "#f59e0b",
              },
            ].map((s) => (
              <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, marginBottom: 2 }}>{s.value}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{s.label}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Goal Estimator ─────────────────────────────────────────────── */}
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: 14,
            padding: "20px 22px",
            marginBottom: 20,
            animation: "lp-slide-up 0.5s ease both",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
                  🎯 Goal Estimator
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  Drag to see how extra study hours unlock new levels
                </p>
              </div>
              <LottiePlayer
                src={avgScoreOverall >= 70 ? LOTTIE_URLS.trophy : LOTTIE_URLS.brain}
                fallback={avgScoreOverall >= 70 ? "🏆" : "🧠"}
                style={{ width: 60, height: 60 }}
              />
            </div>

            {/* Slider */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                  Extra study time
                </span>
                <span style={{
                  fontSize: 15, fontWeight: 800, color: "#1a73e8",
                  background: "rgba(26,115,232,0.1)", padding: "2px 10px", borderRadius: 99,
                }}>
                  {estimatorHours}h / week
                </span>
              </div>
              <input
                type="range"
                min={1} max={20} step={1}
                value={estimatorHours}
                onChange={(e) => setEstimatorHours(Number(e.target.value))}
                style={{
                  width: "100%", height: 6, accentColor: "#1a73e8",
                  cursor: "grab", borderRadius: 99,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                <span>1h</span><span>5h</span><span>10h</span><span>15h</span><span>20h</span>
              </div>
            </div>

            {/* Projection result */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{
                flex: 1, minWidth: 110, padding: "12px 14px",
                background: "rgba(26,115,232,0.06)", border: "1px solid rgba(26,115,232,0.15)",
                borderRadius: 10, textAlign: "center",
                animation: "lp-bounce-in 0.3s ease both",
              }} key={estimatorHours}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#1a73e8" }}>
                  +{levelsGained}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Levels Gained</div>
              </div>
              <div style={{
                flex: 1, minWidth: 110, padding: "12px 14px",
                background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)",
                borderRadius: 10, textAlign: "center",
              }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#10b981" }}>
                  {projectedXp}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Projected XP</div>
              </div>
              <div style={{
                flex: 1, minWidth: 110, padding: "12px 14px",
                background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
                borderRadius: 10, textAlign: "center",
              }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#6366f1" }}>
                  Lv {projectedLevel}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Target Level</div>
              </div>
            </div>

            {levelsGained > 0 && (
              <div style={{
                marginTop: 12, padding: "8px 12px",
                background: "rgba(16,185,129,0.07)", borderRadius: 8,
                fontSize: 12, fontWeight: 600, color: "#10b981",
                display: "flex", alignItems: "center", gap: 6,
                animation: "lp-slide-up 0.3s ease both",
              }}>
                <span style={{ animation: "lp-spin-slow 2s linear infinite", display: "inline-block" }}>⭐</span>
                {estimatorHours}h of study per week will take you to Level {projectedLevel}!
                {levelsGained >= 3 && " You're on fire! 🔥"}
              </div>
            )}
          </div>

          {/* Subject progress + Strengths/Focus */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
            {/* Progress by Subject */}
            <div style={{ flex: "3 1 300px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>Progress by Subject</h3>
              {subjectStats.length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8" }}>No subject data yet. Start a few AI sessions to track your progress.</p>
              ) : (
                <>
                  {visibleSubjects.map((s) => (
                    <div key={s.subject} style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{s.subject}</span>
                          {s.needsFocus && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "#fef3c7", padding: "2px 7px", borderRadius: 999 }}>
                              Needs Focus
                            </span>
                          )}
                          {s.percent >= 80 && (
                            <LottiePlayer
                              src={LOTTIE_URLS.stars}
                              fallback="⭐"
                              loop={false}
                              style={{ width: 32, height: 32, flexShrink: 0 }}
                            />
                          )}
                        </div>
                        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                          {s.mastered}/{s.total} · {s.percent}%
                        </span>
                      </div>
                      <ProgressBar
                        percent={s.percent}
                        color={s.percent >= 75 ? "#22c55e" : s.percent >= 50 ? "#f59e0b" : "#ef4444"}
                      />
                    </div>
                  ))}
                  {subjectStats.length > 5 && (
                    <button
                      onClick={() => setShowAllSubjects((v) => !v)}
                      style={{ background: "none", border: "none", color: "#3b82f6", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginTop: 4, fontFamily: "inherit" }}
                    >
                      {showAllSubjects ? "Show less" : `View all ${subjectStats.length} subjects`}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Strengths & Focus Areas */}
            <div style={{ flex: "2 1 220px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 10 }}>✅ Your Strengths</h3>
                {strengths.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#94a3b8" }}>Complete more sessions to identify your strengths.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {strengths.map((m) => {
                      const avg = getTopicAvgScore(m);
                      const trend = getTopicTrend(m);
                      return (
                        <li key={m.id} style={{ marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <span style={{ color: "#22c55e", marginTop: 2 }}>•</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{m.topic}</span>
                              <span style={{ fontSize: 10, color: "#94a3b8" }}>({m.subject})</span>
                              {avg !== null && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", padding: "1px 6px", borderRadius: 999 }}>
                                  {avg}%
                                </span>
                              )}
                              <span style={{ fontSize: 12, color: trendColor[trend], fontWeight: 700 }}>{trendIcon[trend]}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{m.attempts} attempt{m.attempts !== 1 ? "s" : ""}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 10 }}>🎯 Focus Areas</h3>
                {focusAreas.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#94a3b8" }}>Great job! No urgent focus areas right now.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {focusAreas.map((m) => {
                      const avg = getTopicAvgScore(m);
                      const trend = getTopicTrend(m);
                      return (
                        <li key={m.id} style={{ marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <span style={{ color: "#ef4444", marginTop: 2 }}>•</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{m.topic}</span>
                              <span style={{ fontSize: 10, color: "#94a3b8" }}>({m.subject})</span>
                              {avg !== null && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", background: "#fef2f2", padding: "1px 6px", borderRadius: 999 }}>
                                  {avg}%
                                </span>
                              )}
                              {m.attempts > 0 && (
                                <span style={{ fontSize: 12, color: trendColor[trend], fontWeight: 700 }}>{trendIcon[trend]}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>
                              {m.attempts === 0 ? "Not attempted yet" : `${m.attempts} attempt${m.attempts !== 1 ? "s" : ""}`}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Improvement Chart */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>Improvement Over Time</h3>
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#64748b" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: "#bfdbfe", borderRadius: 2, display: "inline-block" }} /> Past weeks
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: "#3b82f6", borderRadius: 2, display: "inline-block" }} /> This week
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: "#a855f7", borderRadius: 2, display: "inline-block", opacity: 0.7 }} /> Predicted
                </span>
              </div>
            </div>

            {/* Chart area with gridlines */}
            <div style={{ position: "relative", paddingTop: 4 }}>
              {/* Horizontal gridlines */}
              {[0, 25, 50, 75, 100].map((pct) => (
                <div
                  key={pct}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: `${36 + (pct / 100) * 100}px`,
                    borderTop: pct === 0 ? "2px solid #cbd5e1" : "1px dashed #e2e8f0",
                    zIndex: 0,
                  }}
                >
                  <span style={{ position: "absolute", left: -28, fontSize: 10, color: "#cbd5e1", transform: "translateY(-50%)" }}>
                    {pct}%
                  </span>
                </div>
              ))}

              <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 140, paddingLeft: 30, paddingBottom: 36, position: "relative", zIndex: 1 }}>
                {weeklyScores.map((score, i) => {
                  const isNull = score === null;
                  const pct = isNull ? 0 : score;
                  const barH = pct > 0 ? Math.max(6, (pct / 100) * 100) : 4;
                  const barColor = pct > 0 ? (i === 3 ? "#3b82f6" : "#bfdbfe") : "#e2e8f0";
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 }}>
                      {pct > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: i === 3 ? "#3b82f6" : "#64748b" }}>{pct}%</span>
                      )}
                      {pct === 0 && !isNull && (
                        <span style={{ fontSize: 11, color: "#cbd5e1" }}>0%</span>
                      )}
                      {isNull && (
                        <span style={{ fontSize: 11, color: "#cbd5e1" }}>—</span>
                      )}
                      <div
                        style={{
                          width: "100%",
                          maxWidth: 52,
                          height: `${barH}px`,
                          background: barColor,
                          borderRadius: "4px 4px 0 0",
                          transition: "height 0.4s ease",
                        }}
                      />
                      <span style={{ position: "absolute", bottom: 0, fontSize: 11, color: i === 3 ? "#3b82f6" : "#94a3b8", fontWeight: i === 3 ? 700 : 400 }}>{weekLabels[i]}</span>
                    </div>
                  );
                })}

                {/* Predicted next week bar */}
                {predictedNextWeek !== null && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#a855f7" }}>~{predictedNextWeek}%</span>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 52,
                        height: `${Math.max(6, (predictedNextWeek / 100) * 100)}px`,
                        background: "repeating-linear-gradient(45deg, #e9d5ff, #e9d5ff 4px, #a855f7 4px, #a855f7 8px)",
                        borderRadius: "4px 4px 0 0",
                        opacity: 0.85,
                      }}
                    />
                    <span style={{ position: "absolute", bottom: 0, fontSize: 11, color: "#a855f7", fontWeight: 600 }}>{weekLabels[4]} ✦</span>
                  </div>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              Average quiz accuracy per calendar week (Mon–Sun). Next week bar is AI-predicted based on your trend.
            </p>
          </div>

          {/* What's Next (RAG recommendations) */}
          {nextTopics.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>🔭 What to Study Next</h3>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>
                Recommended based on your progress — topics that naturally follow what you've mastered.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                {nextTopics.map((rec, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderLeft: "3px solid #3b82f6",
                      borderRadius: 8,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>{rec.topic}</div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, background: "#dbeafe", color: "#1d4ed8", padding: "2px 7px", borderRadius: 999, fontWeight: 600 }}>{rec.subject}</span>
                      <span style={{ fontSize: 10, background: "#f0f9ff", color: "#0369a1", padding: "2px 7px", borderRadius: 999 }}>{rec.key_stage}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "#64748b", margin: 0, lineHeight: 1.5 }}>{rec.preview}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate("/chat")}
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#3b82f6",
                  background: "none",
                  border: "1px solid #bfdbfe",
                  borderRadius: 7,
                  padding: "6px 16px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Start learning these topics →
              </button>
            </div>
          )}

          {/* Recent Achievements */}
          {achievements.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>Recent Achievements</h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {achievements.map((ach) => (
                  <div
                    key={ach.label}
                    style={{ padding: "7px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, fontSize: 13, fontWeight: 600, color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span>{ach.icon}</span>
                    <span>{ach.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Tutor Tip */}
          <div style={{ padding: "14px 18px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <p style={{ flex: 1, fontSize: 13, color: "#166534", margin: 0, fontStyle: "italic" }}>
              AI Tutor Tip: Focus on <strong>{weakestSubject}</strong> this week — a little practice each day will make a big difference!
            </p>
            <button
              onClick={() => navigate("/chat")}
              style={{ fontSize: 13, fontWeight: 600, color: "#16a34a", background: "white", border: "1px solid #bbf7d0", borderRadius: 7, padding: "5px 14px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
            >
              Practice Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
