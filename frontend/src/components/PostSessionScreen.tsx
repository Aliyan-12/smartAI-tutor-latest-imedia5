import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { appointmentsApi, gamificationApi } from "../services/api";
import type { SessionReport, SessionPhase } from "../types";

interface Props {
  appointmentId: number;
  sessionTitle: string;
  sessionSubject: string;
  durationMinutes: number;
}

export default function PostSessionScreen({
  appointmentId,
  sessionTitle,
  sessionSubject,
  durationMinutes,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [animXp, setAnimXp] = useState(0);
  const [xpTotal, setXpTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchWithRetry = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (cancelled) return;
        try {
          const data: any = await appointmentsApi.getReport(appointmentId);
          if (!cancelled) {
            setReport((data?.report ?? data) as SessionReport);
            setLoading(false);
          }
          return;
        } catch {
          if (attempt < 7) {
            await new Promise((r) => setTimeout(r, 2500));
          } else if (!cancelled) {
            setError("Could not load session report. Your progress has still been saved.");
            setLoading(false);
          }
        }
      }
    };
    fetchWithRetry();
    return () => { cancelled = true; };
  }, [appointmentId]);

  useEffect(() => {
    if (loading) return;
    gamificationApi.getProfile()
      .then((p: any) => {
        setStreak(p?.current_streak ?? 0);
        setXpTotal(p?.xp_total ?? 0);
        // Animate XP count-up
        const target = p?.xp_earned_today ?? xpEarned;
        let start = 0;
        const step = Math.ceil(target / 40);
        const iv = setInterval(() => {
          start += step;
          if (start >= target) { setAnimXp(target); clearInterval(iv); }
          else setAnimXp(start);
        }, 35);
      })
      .catch(() => {});
  }, [loading]); // eslint-disable-line

  const firstName = user?.name?.split(" ")[0] ?? "Student";
  const timeSpent = report?.time_spent_minutes ?? durationMinutes;
  const quizScore = report?.quiz_score_percent;
  const xpEarned = report?.xp_earned ?? 120;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={{ fontSize: 22, marginBottom: 6, letterSpacing: 6, opacity: 0.7 }}>🎊 🌟 ✨ 🎊</div>
          <div style={styles.celebrationEmoji}>🎉</div>
          <h1 style={styles.title}>Nice work, {firstName}!</h1>
          <p style={styles.subtitle}>
            You've completed your lesson and made great progress!
          </p>
        </div>

        <div style={styles.statsRow}>
          <div style={styles.statItem}>
            <span style={styles.statEmoji}>⏱</span>
            <span style={styles.statValue}>{timeSpent} min</span>
            <span style={styles.statLabel}>Time Spent</span>
          </div>
          <div style={styles.statDivider} />
          <div style={styles.statItem}>
            <span style={styles.statEmoji}>📚</span>
            <span style={styles.statValue}>{sessionSubject}</span>
            <span style={styles.statLabel}>Subject</span>
          </div>
          <div style={styles.statDivider} />
          <div style={styles.statItem}>
            <span style={styles.statEmoji}>📈</span>
            <span style={styles.statValue}>
              {quizScore != null ? `${Math.round(quizScore)}%` : "—"}
            </span>
            <span style={styles.statLabel}>Quiz Score</span>
          </div>
          <div style={styles.statDivider} />
          <div style={styles.statItem}>
            <span style={styles.statEmoji}>🎯</span>
            <span style={styles.statValue}>
              {report?.understanding_level ?? "Good"}
            </span>
            <span style={styles.statLabel}>Level</span>
          </div>
        </div>

        <div style={styles.section}>
          <p style={styles.sectionHeading}>What do you want to do next?</p>
          <div style={styles.actionRow}>
            <button style={{ ...styles.actionBtn, borderColor: "#1a73e8", background: "rgba(26,115,232,0.07)" }} onClick={() => navigate("/lesson/setup")}>
              <span style={styles.actionBtnIcon}>🚀</span>
              <span style={styles.actionBtnText}>Start New Lesson</span>
            </button>
            <button style={{ ...styles.actionBtn, borderColor: "var(--accent-blue)", background: "rgba(26,115,232,0.05)" }} onClick={() => navigate("/progress")}>
              <span style={styles.actionBtnIcon}>📊</span>
              <span style={styles.actionBtnText}>View My Progress</span>
            </button>
            <button style={styles.actionBtn} onClick={() => navigate("/chat")}>
              <span style={styles.actionBtnIcon}>🤖</span>
              <span style={styles.actionBtnText}>Ask AI Tutor</span>
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <p style={styles.insightHeading}>🤖 AI Tutor Insight</p>
          {loading ? (
            <div style={styles.skeletonWrap}>
              {[120, 200, 160, 100].map((w, i) => (
                <div key={i} style={{ ...styles.skeletonLine, width: w }} />
              ))}
            </div>
          ) : error ? (
            <p style={styles.errorText}>
              Could not load session report. Your progress has still been saved.
            </p>
          ) : report ? (
            <div style={styles.insightBox}>
              <p style={styles.insightText}>{report.summary}</p>
              {report.topics_covered?.length > 0 && (
                <div style={styles.tagsRow}>
                  {report.topics_covered.map((t) => (
                    <span key={t} style={styles.topicTag}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {report.next_session_recommendation && (
                <p style={styles.recommendation}>
                  <strong>Next session: </strong>
                  {report.next_session_recommendation}
                </p>
              )}
              {report.weak_areas?.length > 0 && (
                <div style={styles.areasRow}>
                  <div>
                    <p style={styles.areasLabel}>Areas to review</p>
                    <div style={styles.tagsRow}>
                      {report.weak_areas.map((a) => (
                        <span key={a} style={styles.weakTag}>
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                  {report.strong_areas?.length > 0 && (
                    <div>
                      <p style={styles.areasLabel}>Strong areas</p>
                      <div style={styles.tagsRow}>
                        {report.strong_areas.map((a) => (
                          <span key={a} style={styles.strongTag}>
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {typeof report.student_messages_count === "number" && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                  {report.student_messages_count} student messages · {report.ai_messages_count ?? 0} AI responses
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Phase Breakdown */}
        {report?.phases && report.phases.length > 0 && (
          <div style={{ ...styles.section, paddingBottom: 16 }}>
            <p style={styles.sectionHeading}>📋 Lesson Breakdown</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {report.phases.map((phase: SessionPhase, i: number) => {
                const statusColor =
                  phase.status === "completed" ? "#10b981" :
                  phase.status === "partial" ? "#f59e0b" : "#94a3b8";
                const statusDot = phase.status === "completed" ? "✓" : phase.status === "partial" ? "~" : "–";
                return (
                  <div key={i} style={{
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: statusColor + "22",
                      border: `1.5px solid ${statusColor}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: statusColor,
                      flexShrink: 0, marginTop: 1,
                    }}>
                      {statusDot}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                          {phase.phase_title}
                        </span>
                        {phase.planned_minutes && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
                            {phase.planned_minutes} min
                          </span>
                        )}
                        <span style={{
                          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                          color: statusColor, letterSpacing: "0.5px",
                        }}>
                          {phase.status}
                        </span>
                      </div>
                      {phase.what_was_covered && (
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "4px 0 2px", lineHeight: 1.4 }}>
                          {phase.what_was_covered}
                        </p>
                      )}
                      {phase.student_engagement && (
                        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
                          {phase.student_engagement}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 16, padding: "18px 28px",
          background: "linear-gradient(135deg, rgba(26,115,232,0.08) 0%, rgba(99,102,241,0.08) 100%)",
          borderBottom: "1px solid var(--border-color)",
          flexWrap: "wrap",
        }}>
          {/* XP Earned */}
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{
              fontSize: 36, fontWeight: 800,
              background: "linear-gradient(135deg, #1a73e8, #6366f1)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              lineHeight: 1,
            }}>
              +{animXp}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>XP Earned</div>
          </div>

          <div style={{ width: 1, height: 40, background: "var(--border-color)" }} />

          {/* Streak */}
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#f97316", lineHeight: 1 }}>
              🔥 {streak}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>Day Streak</div>
          </div>

          <div style={{ width: 1, height: 40, background: "var(--border-color)" }} />

          {/* Total XP */}
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#10b981", lineHeight: 1 }}>
              {xpTotal}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total XP</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            style={styles.backBtn}
            onClick={() => navigate("/dashboard")}
          >
            ← Back to Dashboard
          </button>
          <button
            style={{ ...styles.backBtn, background: "rgba(26,115,232,0.08)", borderColor: "rgba(26,115,232,0.3)", color: "#1a73e8" }}
            onClick={() => navigate("/progress")}
          >
            📈 View Weekly Progress
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    minHeight: "100vh",
    background: "var(--bg-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
  },
  card: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 16,
    maxWidth: 680,
    width: "100%",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  },
  header: {
    background: "linear-gradient(135deg, #1a73e8 0%, #6366f1 60%, #8b5cf6 100%)",
    padding: "36px 32px 30px",
    textAlign: "center",
    color: "white",
    position: "relative",
    overflow: "hidden",
  },
  celebrationEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    margin: "0 0 8px",
    color: "white",
  },
  subtitle: {
    fontSize: 15,
    opacity: 0.9,
    margin: 0,
    color: "rgba(255,255,255,0.88)",
  },
  statsRow: {
    display: "flex",
    alignItems: "stretch",
    borderBottom: "1px solid var(--border-color)",
  },
  statItem: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "20px 8px",
    gap: 4,
  },
  statDivider: {
    width: 1,
    background: "var(--border-color)",
    margin: "12px 0",
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    textAlign: "center",
  },
  statLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontWeight: 500,
    textAlign: "center",
  },
  section: {
    padding: "20px 28px",
    borderBottom: "1px solid var(--border-color)",
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-secondary)",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  actionRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  actionBtn: {
    flex: 1,
    minWidth: 140,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "14px 12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 10,
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  },
  actionBtnIcon: {
    fontSize: 22,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
    textAlign: "center",
    lineHeight: 1.3,
  },
  insightHeading: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 12,
  },
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  skeletonLine: {
    height: 14,
    background: "var(--bg-tertiary)",
    borderRadius: 6,
    animation: "pulse 1.5s ease-in-out infinite",
  },
  errorText: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  insightBox: {
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 10,
    padding: "14px 16px",
  },
  insightText: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    marginBottom: 10,
  },
  tagsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  topicTag: {
    padding: "3px 10px",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    background: "rgba(99,102,241,0.1)",
    color: "#6366f1",
    border: "1px solid rgba(99,102,241,0.2)",
  },
  recommendation: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginTop: 8,
  },
  areasRow: {
    display: "flex",
    gap: 16,
    marginTop: 10,
    flexWrap: "wrap",
  },
  areasLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: 6,
  },
  weakTag: {
    padding: "3px 10px",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--danger-light, rgba(217,48,37,0.08))",
    color: "var(--danger)",
    border: "1px solid rgba(217,48,37,0.2)",
  },
  strongTag: {
    padding: "3px 10px",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--success-light, rgba(24,128,56,0.08))",
    color: "var(--success)",
    border: "1px solid rgba(24,128,56,0.2)",
  },
  xpBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "14px 28px",
    background: "rgba(99,102,241,0.06)",
    borderBottom: "1px solid var(--border-color)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    flexWrap: "wrap",
  },
  xpBadge: {
    background: "var(--accent-blue)",
    color: "white",
    borderRadius: 99,
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  xpDivider: {
    color: "var(--border-color)",
  },
  backBtn: {
    display: "block",
    width: "calc(100% - 56px)",
    margin: "20px 28px",
    padding: "12px 20px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-secondary)",
    cursor: "pointer",
    textAlign: "center",
    transition: "background 0.15s",
  },
};
