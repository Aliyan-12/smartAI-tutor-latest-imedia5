import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { appointmentsApi } from "../services/api";
import type { SessionReport } from "../types";

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

  useEffect(() => {
    appointmentsApi
      .getReport(appointmentId)
      .then((data: any) => setReport((data?.report ?? data) as SessionReport))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appointmentId]);

  const firstName = user?.name?.split(" ")[0] ?? "Student";
  const timeSpent = report?.time_spent_minutes ?? durationMinutes;
  const quizScore = report?.quiz_score_percent;
  const xpEarned = report?.xp_earned ?? 120;

  const goToContinue = () => {
    navigate("/lesson/setup", { state: { subject: sessionSubject } });
  };

  const goToPracticeWeak = () => {
    const weakTopic = report?.weak_areas?.[0] ?? "";
    navigate("/lesson/setup", {
      state: { subject: sessionSubject, goal: "practice", topic: weakTopic },
    });
  };

  const goToNextTopic = () => {
    navigate("/lesson/setup", { state: { subject: sessionSubject } });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
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
            <button style={styles.actionBtn} onClick={goToContinue}>
              <span style={styles.actionBtnIcon}>↩</span>
              <span style={styles.actionBtnText}>Continue where left off</span>
            </button>
            <button style={styles.actionBtn} onClick={goToPracticeWeak}>
              <span style={styles.actionBtnIcon}>🎯</span>
              <span style={styles.actionBtnText}>Practice Weak Areas</span>
            </button>
            <button style={styles.actionBtn} onClick={goToNextTopic}>
              <span style={styles.actionBtnIcon}>▶</span>
              <span style={styles.actionBtnText}>Next Topic</span>
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
            </div>
          ) : null}
        </div>

        <div style={styles.xpBanner}>
          <span>🏆 Keep it up!</span>
          <span style={styles.xpBadge}>+{xpEarned} XP earned</span>
          <span style={styles.xpDivider}>|</span>
          <span>🔥 Keep your streak going</span>
        </div>

        <button
          style={styles.backBtn}
          onClick={() => navigate("/chat")}
        >
          ← Back to Dashboard
        </button>
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
    background: "linear-gradient(135deg, var(--accent-blue) 0%, #6366f1 100%)",
    padding: "32px 32px 28px",
    textAlign: "center",
    color: "white",
  },
  celebrationEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    margin: "0 0 8px",
    color: "black",
  },
  subtitle: {
    fontSize: 15,
    opacity: 0.9,
    margin: 0,
    color: "black",
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
