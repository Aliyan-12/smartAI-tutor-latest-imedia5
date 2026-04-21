import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { gamificationApi, assessmentsApi, appointmentsApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { TopicMastery, StudentProfile, Assessment, Appointment } from "../types";

interface SubjectStats {
  subject: string;
  total: number;
  mastered: number;
  percent: number;
  needsFocus: boolean;
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

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div
      style={{
        height: 8,
        background: "#e2e8f0",
        borderRadius: 999,
        overflow: "hidden",
        flex: 1,
        minWidth: 80,
      }}
    >
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubjects, setShowAllSubjects] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [profileData, masteryData] = await Promise.all([
          gamificationApi.getProfile() as Promise<StudentProfile>,
          gamificationApi.getMastery() as Promise<TopicMastery[]>,
        ]);
        setProfile(profileData);
        setMastery(masteryData);

        // Load sessions and assessments in parallel (non-fatal)
        await Promise.allSettled([
          user
            ? assessmentsApi.listForStudent(user.id).then((d) => setAssessments(d as Assessment[])).catch(() => {})
            : Promise.resolve(),
          appointmentsApi.list().then((d) => {
            const done = (d as Appointment[]).filter((a) =>
              ["completed", "terminated"].includes(a.status)
            );
            setSessions(done);
          }).catch(() => {}),
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
    .slice(0, 4);

  const focusAreas = mastery
    .filter((m) => m.mastery_level === "learning" || m.mastery_level === "not_started")
    .sort((a, b) => a.attempts - b.attempts)
    .slice(0, 4);

  const completedAssessments = assessments.filter((a) => a.status === "completed");

  // Top-level stats from actual session appointments
  const totalStudyMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const sessionsDone = sessions.length;
  const totalTopics = mastery.length;

  // Quiz accuracy from assessments
  const totalQuestionsCorrect = completedAssessments.reduce((sum, a) => sum + (a.correct_answers ?? 0), 0);
  const totalQuestionsAttempted = completedAssessments.reduce((sum, a) => sum + (a.total_questions ?? 0), 0);
  const accuracyPercent =
    totalQuestionsAttempted > 0
      ? Math.round((totalQuestionsCorrect / totalQuestionsAttempted) * 100)
      : null;

  // Weekly chart — based on assessments quiz scores by week
  const weeklyScores: number[] = (() => {
    const now = Date.now();
    const weeks = [0, 1, 2, 3].map((w) => {
      const start = now - (w + 1) * 7 * 24 * 3600 * 1000;
      const end = now - w * 7 * 24 * 3600 * 1000;
      const weekAsm = completedAssessments.filter((a) => {
        const t = new Date(a.created_at).getTime();
        return t >= start && t < end;
      });
      if (weekAsm.length === 0) return null;
      return Math.round(weekAsm.reduce((s, a) => s + (a.score_percent ?? 0), 0) / weekAsm.length);
    });
    return weeks.reverse().map((v) => v ?? 0);
  })();

  const weakestSubject = subjectStats.find((s) => s.needsFocus)?.subject ?? "your weaker topics";

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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {[
              { icon: "📚", value: formatStudyTime(totalStudyMinutes), label: "Total Study Time" },
              { icon: "✅", value: String(sessionsDone), label: "Sessions Done" },
              {
                icon: "❓",
                value: accuracyPercent !== null ? `${accuracyPercent}%` : "—",
                label: "Questions Correct",
              },
              { icon: "🗂️", value: String(totalTopics), label: "Topics Covered" },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "16px 18px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 2 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Main two-column section */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {/* Progress by Subject */}
              <div
                style={{
                  flex: "3 1 300px",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "18px 20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>
                  Progress by Subject
                </h3>
                {subjectStats.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>
                    No subject data yet. Start a few AI sessions to track your progress.
                  </p>
                ) : (
                  <>
                    {visibleSubjects.map((s) => (
                      <div key={s.subject} style={{ marginBottom: 14 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 5,
                          }}
                        >
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                              {s.subject}
                            </span>
                            {s.needsFocus && (
                              <span
                                style={{
                                  marginLeft: 7,
                                  fontSize: 11,
                                  color: "#f59e0b",
                                  fontWeight: 700,
                                }}
                              >
                                Needs Focus ⚠️
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                            {s.mastered}/{s.total} topics · {s.percent}%
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
                        style={{
                          background: "none",
                          border: "none",
                          color: "#3b82f6",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                          marginTop: 4,
                          fontFamily: "inherit",
                        }}
                      >
                        {showAllSubjects ? "Show less" : `View all ${subjectStats.length} subjects`}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Strengths & Focus Areas */}
              <div
                style={{
                  flex: "2 1 200px",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "18px 20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 10 }}>
                    ✅ Your Strengths
                  </h3>
                  {strengths.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#94a3b8" }}>
                      Complete more sessions to identify your strengths.
                    </p>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {strengths.map((m) => (
                        <li
                          key={m.id}
                          style={{ fontSize: 13, color: "#475569", marginBottom: 6, paddingLeft: 12, position: "relative" }}
                        >
                          <span style={{ position: "absolute", left: 0, color: "#22c55e" }}>•</span>
                          {m.topic}
                          <span style={{ fontSize: 11, color: "#94a3b8" }}> ({m.subject})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 10 }}>
                    🎯 Focus Areas
                  </h3>
                  {focusAreas.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#94a3b8" }}>
                      Great job! No urgent focus areas right now.
                    </p>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {focusAreas.map((m) => (
                        <li
                          key={m.id}
                          style={{ fontSize: 13, color: "#475569", marginBottom: 6, paddingLeft: 12, position: "relative" }}
                        >
                          <span style={{ position: "absolute", left: 0, color: "#ef4444" }}>•</span>
                          {m.topic}
                          <span style={{ fontSize: 11, color: "#94a3b8" }}> ({m.subject})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Improvement Chart */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "18px 20px",
              marginBottom: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 18 }}>
              Improvement Over Time
            </h3>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 20, height: 120 }}>
              {weeklyScores.map((score, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    height: "100%",
                    justifyContent: "flex-end",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{score}%</span>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 48,
                      height: `${(score / 100) * 80}px`,
                      background: i === 3 ? "#3b82f6" : "#bfdbfe",
                      borderRadius: "4px 4px 0 0",
                      transition: "height 0.4s ease",
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Week {i + 1}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 12, margin: 0 }}>
              Average accuracy across your quizzes over the last 4 weeks
            </p>
          </div>

          {/* Recent Achievements */}
          {achievements.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "16px 20px",
                marginBottom: 16,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
                Recent Achievements
              </h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {achievements.map((ach) => (
                  <div
                    key={ach.label}
                    style={{
                      padding: "7px 14px",
                      background: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#92400e",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>{ach.icon}</span>
                    <span>{ach.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Tutor Tip */}
          <div
            style={{
              padding: "14px 18px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 18 }}>🤖</span>
            <p style={{ flex: 1, fontSize: 13, color: "#166534", margin: 0, fontStyle: "italic" }}>
              AI Tutor Tip: Focus on <strong>{weakestSubject}</strong> this week — a little practice each day will make a big difference!
            </p>
            <button
              onClick={() => navigate("/chat")}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#16a34a",
                background: "white",
                border: "1px solid #bbf7d0",
                borderRadius: 7,
                padding: "5px 14px",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Practice Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
