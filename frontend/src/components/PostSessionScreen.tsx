import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { appointmentsApi, gamificationApi } from "../services/api";
import type { SessionReport, SessionPhase } from "../types";
import LottiePlayer, { LOTTIE_URLS } from "./LottiePlayer";
import { Check, Pause, Minus } from "lucide-react";

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
      // Give the backend pipeline a moment to start before the first poll
      await new Promise((r) => setTimeout(r, 1500));
      for (let attempt = 0; attempt < 20; attempt++) {
        if (cancelled) return;
        try {
          const data: any = await appointmentsApi.getReport(appointmentId);
          // Backend returns {pending: true} while session hasn't ended yet — retry
          if (data?.pending) {
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          }
          if (!cancelled) {
            setReport((data?.report ?? data) as SessionReport);
            setLoading(false);
          }
          return;
        } catch {
          if (attempt < 19) {
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
        // Animate XP count-up — show THIS session's XP (from the report), not today's total.
        const target = xpEarned;
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
  const xpEarned = report?.xp_earned ?? 0;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.headerGlow} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <span style={styles.completeBadge}>⭐ Lesson Complete</span>
            <h1 style={styles.title}>Nice work, {firstName}!</h1>
            <p style={styles.subtitle}>You've completed your lesson and made great progress!</p>
          </div>
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={styles.keepGoing}>Keep going!</span>
            <LottiePlayer src={LOTTIE_URLS.trophy} fallback="🏆" style={{ width: 88, height: 88 }} />
          </div>
        </div>

        <div style={styles.statsRow}>
          {[
            { icon: "⏱️", val: `${timeSpent} min`, label: "Time Spent", bg: "#f5f3ff" },
            { icon: "📘", val: sessionSubject, label: "Subject", bg: "#eff6ff" },
            { icon: "📈", val: quizScore != null ? `${Math.round(quizScore)}%` : "—", label: "Quiz Score", bg: "#f0fdf4" },
            { icon: "🎯", val: report?.understanding_level ?? "Good", label: "Level", bg: "#fff7ed" },
          ].map((s, i) => (
            <div key={s.label} style={{ ...styles.statItem, borderLeft: i > 0 ? "1px solid var(--border-color)" : "none" }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, marginBottom: 6 }}>{s.icon}</div>
              <span style={styles.statValue}>{s.val}</span>
              <span style={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>

        <div style={styles.section}>
          <p style={styles.sectionHeading}>What do you want to do next?</p>
          <div style={styles.actionRow}>
            {[
              { icon: "🚀", title: "Start New Lesson", sub: "Keep the momentum going", color: "#1a73e8", bg: "#eff6ff", onClick: () => navigate("/lesson/setup") },
              { icon: "📊", title: "View My Progress", sub: "See how you're doing", color: "#7c3aed", bg: "#f5f3ff", onClick: () => navigate("/progress") },
              { icon: "🤖", title: "Ask AI Tutor", sub: "Get help or ask a question", color: "#f59e0b", bg: "#fffbeb", onClick: () => navigate("/chat") },
            ].map((a) => (
              <button key={a.title} style={{ ...styles.actionBtn, background: a.bg, borderColor: `${a.color}33` }} onClick={a.onClick}>
                <span style={{ width: 40, height: 40, borderRadius: 11, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{a.icon}</span>
                <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{a.title}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#64748b" }}>{a.sub}</span>
                </span>
                <span style={{ color: a.color, fontWeight: 800, fontSize: 16 }}>→</span>
              </button>
            ))}
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
            <div style={{ display: "flex", flexDirection: "column" }}>
              {report.phases.map((phase: SessionPhase, i: number, arr: SessionPhase[]) => {
                const isLast = i === arr.length - 1;
                const statusColor =
                  phase.status === "completed" ? "#10b981" :
                  phase.status === "partial" ? "#f59e0b" : "#cbd5e1";
                const Icon = phase.status === "completed" ? Check : phase.status === "partial" ? Pause : Minus;
                return (
                  <div key={i} style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                    {/* Timeline rail: solid circle + connecting line */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: "50%", background: statusColor,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, boxShadow: `0 2px 6px ${statusColor}66`,
                      }}>
                        <Icon size={15} color="#fff" strokeWidth={3} />
                      </div>
                      {!isLast && <div style={{ width: 2, flex: 1, minHeight: 16, background: "var(--border-color)", margin: "3px 0" }} />}
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, paddingBottom: isLast ? 4 : 16, borderBottom: isLast ? "none" : "1px solid var(--border-color)", marginBottom: isLast ? 0 : 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)" }}>
                          {phase.phase_title}
                        </span>
                        {phase.planned_minutes && (
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>
                            {phase.planned_minutes} min
                          </span>
                        )}
                        <span style={{
                          fontSize: 10, fontWeight: 800, textTransform: "uppercase",
                          color: phase.status === "not_started" ? "#64748b" : statusColor,
                          background: (phase.status === "not_started" ? "#94a3b8" : statusColor) + "1a",
                          padding: "2px 9px", borderRadius: 999, letterSpacing: "0.4px",
                        }}>
                          {phase.status.replace("_", " ")}
                        </span>
                      </div>
                      {phase.what_was_covered && (
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "5px 0 2px", lineHeight: 1.45 }}>
                          {phase.what_was_covered}
                        </p>
                      )}
                      {phase.student_engagement && (
                        <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
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
          flexWrap: "wrap", position: "relative", overflow: "hidden",
        }}>
          {/* Confetti accents */}
          {([
            { pos: { top: 14, left: "12%" }, c: "#f59e0b", r: "-25deg" },
            { pos: { top: 26, left: "30%" }, c: "#3b82f6", r: "40deg" },
            { pos: { bottom: 16, left: "22%" }, c: "#10b981", r: "15deg" },
            { pos: { top: 16, right: "14%" }, c: "#8b5cf6", r: "30deg" },
            { pos: { bottom: 18, right: "28%" }, c: "#ef4444", r: "-20deg" },
            { pos: { top: 30, right: "34%" }, c: "#06b6d4", r: "-45deg" },
          ] as const).map((d, i) => (
            <span key={i} aria-hidden style={{ position: "absolute", ...d.pos, width: 8, height: 3, borderRadius: 2, background: d.c, transform: `rotate(${d.r})`, opacity: 0.85, pointerEvents: "none" }} />
          ))}
          {/* XP Earned */}
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{
              fontSize: 34, fontWeight: 800,
              background: "linear-gradient(135deg, #1a73e8, #6366f1)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              lineHeight: 1,
            }}>
              ⭐ +{animXp}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>XP Earned</div>
          </div>

          <div style={{ width: 1, height: 40, background: "var(--border-color)" }} />

          {/* Streak */}
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#f97316", lineHeight: 1 }}>
              🔥 {streak}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Day Streak</div>
          </div>

          <div style={{ width: 1, height: 40, background: "var(--border-color)" }} />

          {/* Total XP */}
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#10b981", lineHeight: 1 }}>
              🏆 {xpTotal}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total XP</div>
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
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "32px 16px 48px",
  },
  card: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 18,
    maxWidth: 860,
    width: "100%",
    overflow: "hidden",
    boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
  },
  header: {
    background: "linear-gradient(120deg, #1a73e8 0%, #6366f1 55%, #8b5cf6 100%)",
    padding: "30px 34px",
    color: "white",
    position: "relative",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
  },
  headerGlow: {
    position: "absolute",
    top: -60, right: -20, width: 220, height: 220, borderRadius: "50%",
    background: "radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 65%)",
    pointerEvents: "none",
  },
  completeBadge: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.32)",
    borderRadius: 999, padding: "4px 13px", fontSize: 11, fontWeight: 800,
    letterSpacing: "0.5px", marginBottom: 12,
  },
  keepGoing: {
    fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
    fontSize: 15, color: "rgba(255,255,255,0.95)", transform: "rotate(-8deg)",
    whiteSpace: "nowrap",
  },
  title: {
    fontSize: 27,
    fontWeight: 800,
    margin: "0 0 6px",
    color: "white",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    fontSize: 14.5,
    opacity: 0.92,
    margin: 0,
    color: "rgba(255,255,255,0.9)",
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
    minWidth: 210,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: "13px 15px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    cursor: "pointer",
    transition: "border-color 0.15s, transform 0.15s",
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
