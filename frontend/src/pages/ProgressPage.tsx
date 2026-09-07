import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Target, ArrowRight, BarChart2 } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PageLoading from "../components/PageLoading";
import { gamificationApi, assessmentsApi, appointmentsApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { TopicMastery, StudentProfile, Assessment, Appointment } from "../types";

const SUBJECT_PALETTE: Record<string, { color: string; bg: string; icon: string }> = {
  maths:              { color: "#f97316", bg: "#fff7ed", icon: "🧮" },
  mathematics:        { color: "#f97316", bg: "#fff7ed", icon: "🧮" },
  science:            { color: "#22c55e", bg: "#f0fdf4", icon: "🔬" },
  biology:            { color: "#22c55e", bg: "#f0fdf4", icon: "🧬" },
  chemistry:          { color: "#ec4899", bg: "#fdf2f8", icon: "⚗️" },
  physics:            { color: "#06b6d4", bg: "#ecfeff", icon: "⚛️" },
  english:            { color: "#3b82f6", bg: "#eff6ff", icon: "📚" },
  history:            { color: "#a855f7", bg: "#faf5ff", icon: "🏛️" },
  geography:          { color: "#10b981", bg: "#ecfdf5", icon: "🌍" },
  art:                { color: "#f59e0b", bg: "#fffbeb", icon: "🎨" },
  "computer science": { color: "#6366f1", bg: "#eef2ff", icon: "💻" },
  computing:          { color: "#6366f1", bg: "#eef2ff", icon: "💻" },
};

function getSubjectPalette(subject: string) {
  return SUBJECT_PALETTE[subject.toLowerCase()] ?? { color: "#64748b", bg: "#f8fafc", icon: "📖" };
}

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

// Count skills within a subject by band (matches the reference "strong · developing · need practice").
function subjectSkillCounts(mastery: TopicMastery[], subject: string) {
  const rows = mastery.filter((m) => m.subject === subject);
  return {
    strong: rows.filter((m) => m.mastery_level === "mastered").length,
    developing: rows.filter((m) => m.mastery_level === "practicing" || m.mastery_level === "learning").length,
    needPractice: rows.filter((m) => m.mastery_level === "not_started").length,
  };
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

// A mastery level → friendly band badge (Secure / Strong / Developing / Needs practice).
function masteryBadge(level: string): { label: string; color: string; bg: string } {
  switch (level) {
    case "mastered":   return { label: "Secure", color: "#16a34a", bg: "#f0fdf4" };
    case "practicing": return { label: "Strong", color: "#2563eb", bg: "#eff6ff" };
    case "learning":   return { label: "Developing", color: "#d97706", bg: "#fffbeb" };
    default:           return { label: "Needs practice", color: "#dc2626", bg: "#fef2f2" };
  }
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
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load progress");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const subjectStats = buildSubjectStats(mastery);

  const strengths = mastery
    .filter((m) => m.mastery_level === "mastered" || m.mastery_level === "practicing")
    .sort((a, b) => (getTopicAvgScore(b) ?? 0) - (getTopicAvgScore(a) ?? 0))
    .slice(0, 4);

  const focusAreas = mastery
    .filter((m) => m.mastery_level === "learning" || m.mastery_level === "not_started")
    .sort((a, b) => a.attempts - b.attempts)
    .slice(0, 4);

  const completedAssessments = assessments.filter((a) => a.status === "completed");
  const totalTopics = mastery.length;
  const masteredCount = mastery.filter((m) => m.mastery_level === "mastered").length;

  const totalQuestionsCorrect = completedAssessments.reduce((sum, a) => sum + (a.correct_answers ?? 0), 0);
  const totalQuestionsAttempted = completedAssessments.reduce((sum, a) => sum + (a.total_questions ?? 0), 0);
  const accuracyPercent =
    totalQuestionsAttempted > 0
      ? Math.round((totalQuestionsCorrect / totalQuestionsAttempted) * 100)
      : null;

  // Start of the current calendar week (Monday 00:00).
  const thisMonday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  })();
  const weekStartMs = thisMonday.getTime();

  // Weekly chart scores: 4 calendar weeks, index 3 = this week.
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

  const weekLabels: string[] = ["W1", "W2", "W3", "This week"];

  const nonZeroWeeks = weeklyScores
    .map((s) => s)
    .filter((s): s is number => s !== null && s > 0);
  const improvementDelta =
    nonZeroWeeks.length >= 2 ? nonZeroWeeks[nonZeroWeeks.length - 1] - nonZeroWeeks[0] : 0;

  // This-week engagement figures.
  const WEEKLY_GOAL = 5;
  const sessionsThisWeekList = sessions.filter((s) => {
    const raw = s.session_started_at ?? s.scheduled_at ?? null;
    return raw ? new Date(raw).getTime() >= weekStartMs : false;
  });
  const sessionsThisWeek = sessionsThisWeekList.length;
  const studyMinutesThisWeek = sessionsThisWeekList.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const sessionsToGoal = Math.max(0, WEEKLY_GOAL - sessionsThisWeek);
  const weeklyGoalPct = Math.min(100, Math.round((sessionsThisWeek / WEEKLY_GOAL) * 100));

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const weakest = subjectStats.find((s) => s.needsFocus) ?? subjectStats[subjectStats.length - 1];
  const weakestSubject = weakest?.subject ?? "your weaker topics";
  const primarySubject = subjectStats[0];

  // The single skill we nudge the student to practise next.
  const recFocus = focusAreas[0] ?? null;
  const recAvg = recFocus ? getTopicAvgScore(recFocus) : null;

  if (loading) return <PageLoading />;

  return (
    <div className="main-content">
        <div className="dashboard-content">
          <style>{`
            .pg-grid-2 { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; margin-bottom: 16px; }
            .pg-grid-eq { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
            .pg-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            .pg-card-title { font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 14px; display: flex; align-items: center; gap: 7px; }
            .pg-hero-stat { display: flex; align-items: center; gap: 7px; color: #fff; font-size: 13px; font-weight: 700; }
            @media (max-width: 900px) {
              .pg-grid-2, .pg-grid-eq { grid-template-columns: 1fr; }
              .pg-hero-art { display: none !important; }
            }
          `}</style>

          {error && (
            <div style={{ padding: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* ── Banner: "My Progress" mountain-path (ref image #14) ── */}
          <div style={{
            background: "linear-gradient(110deg, #10b981 0%, #22c55e 30%, #3b82f6 100%)",
            borderRadius: 18, padding: "24px 28px", marginBottom: 16, minHeight: 150,
            position: "relative", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
          }}>
            {/* soft cloud blobs */}
            <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none",
              backgroundImage: "radial-gradient(circle at 60% 120%, rgba(255,255,255,0.18), transparent 45%), radial-gradient(circle at 90% -10%, rgba(255,255,255,0.15), transparent 40%)" }} />

            {/* Left — title + subtitle */}
            <div style={{ position: "relative", zIndex: 2, maxWidth: 360, flexShrink: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,0.2)", marginBottom: 10 }}>
                <BarChart2 size={18} color="#fff" />
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
                My <span style={{ borderBottom: "4px solid rgba(255,255,255,0.55)", paddingBottom: 1 }}>Progress</span>
              </h1>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.92)", margin: "8px 0 0" }}>
                See how you're improving and where to focus more.
              </p>
            </div>

            {/* Middle — ascending milestone path + cheering robot (decorative) */}
            <div className="pg-hero-art" style={{ position: "relative", flex: 1, height: 120, minWidth: 320 }}>
              {[
                { label: "Keep going!", left: "2%", bottom: 4, bg: "#fff", color: "#0f766e" },
                { label: "You're improving!", left: "26%", bottom: 34, bg: "#22d3ee", color: "#083344" },
                { label: "Great progress!", left: "52%", bottom: 66, bg: "#bbf7d0", color: "#065f46" },
              ].map((m) => (
                <div key={m.label} style={{ position: "absolute", left: m.left, bottom: m.bottom, zIndex: 2 }}>
                  <span style={{ background: m.bg, color: m.color, fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, boxShadow: "0 3px 8px rgba(0,0,0,0.15)", whiteSpace: "nowrap" }}>{m.label}</span>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fff", border: "3px solid #38bdf8", margin: "5px auto 0" }} />
                </div>
              ))}
              <span style={{ position: "absolute", left: "70%", bottom: 92, fontSize: 22, zIndex: 2 }}>🚩</span>
              <img src="/images/robotAI.png" alt="" draggable={false}
                style={{ position: "absolute", right: 6, bottom: -8, height: 128, width: "auto", objectFit: "contain", zIndex: 1, filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.18))" }} />
              <span style={{ position: "absolute", right: 4, top: 2, fontFamily: '"Segoe Print","Bradley Hand","Comic Sans MS",cursive', fontSize: 14, color: "rgba(255,255,255,0.96)", textAlign: "right", lineHeight: 1.2, zIndex: 2 }}>
                Progress builds<br />brighter futures!
              </span>
            </div>

            {/* Right — Level / XP badge */}
            <div className="pg-hero-art" style={{ position: "relative", zIndex: 2, flexShrink: 0, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 14, padding: "12px 16px", minWidth: 150, backdropFilter: "blur(4px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <BarChart2 size={16} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", lineHeight: 1 }}>Level {profile?.xp_level ?? 1}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{(profile?.xp_total ?? 0).toLocaleString()} XP</div>
                </div>
              </div>
              <div style={{ height: 7, background: "rgba(255,255,255,0.25)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.max(10, ((profile?.xp_total ?? 0) % 500) / 5))}%`, background: "#fff", borderRadius: 999 }} />
              </div>
            </div>
          </div>

          {/* ── Recommended for You + This Week ── */}
          <div className="pg-grid-2">
            <div className="pg-card" style={{ borderLeft: "4px solid #7c3aed" }}>
              <p className="pg-card-title"><Target size={16} color="#7c3aed" /> Recommended for You</p>
              {recFocus ? (
                <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{recFocus.topic}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#d97706", background: "#fffbeb", padding: "2px 10px", borderRadius: 999 }}>Developing</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 12px", lineHeight: 1.5 }}>
                      A little more practice with <strong>{recFocus.topic}</strong> ({recFocus.subject}) will help you become secure.
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                      <div style={{ flex: 1, height: 8, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${recAvg ?? 40}%`, background: "linear-gradient(90deg,#7c3aed,#a855f7)", borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}>{recAvg ?? 40}%</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, margin: "0 0 16px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 5 }}>⏱️ 10 min practice</span>
                      <span style={{ fontSize: 12, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 5 }}>📄 Similar questions</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      <button
                        onClick={() => navigate("/lesson/setup", { state: { subject: recFocus.subject, topic: recFocus.topic, goal: "revision" } })}
                        style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}
                      >
                        Practise This Skill <ArrowRight size={15} />
                      </button>
                      <span title="We suggest this because it's your least-secure recent topic — practising it lifts your overall mastery." style={{ fontSize: 12.5, fontWeight: 700, color: "#1a73e8", cursor: "help" }}>
                        Why am I seeing this?
                      </span>
                    </div>
                  </div>
                  {/* Flashcard visual */}
                  <div className="pg-hero-art" style={{ width: 120, flexShrink: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ position: "absolute", inset: "16px 4px", background: "#eef2ff", borderRadius: 12, transform: "rotate(-7deg)" }} />
                    <div style={{ position: "relative", width: 104, height: 118, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 10, boxShadow: "0 6px 16px rgba(124,58,237,0.15)" }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#6d28d9", lineHeight: 1.25 }}>{recFocus.topic}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
                  Complete a few sessions and we'll recommend the best skill to practise next.
                </p>
              )}
            </div>

            <div className="pg-card">
              <p className="pg-card-title">🗓️ This Week</p>
              {[
                { icon: "📊", val: `${sessionsThisWeek}`, sub: `of ${WEEKLY_GOAL} weekly goal`, label: "Sessions completed", color: "#3b82f6" },
                { icon: "⏱️", val: formatStudyTime(studyMinutesThisWeek), sub: "", label: "Total study time", color: "#8b5cf6" },
                { icon: "🎯", val: accuracyPercent !== null ? `${accuracyPercent}%` : "—", sub: "", label: "Quiz accuracy", color: "#f97316" },
                { icon: "🔥", val: `${profile?.current_streak ?? 0} day`, sub: "Keep it up!", label: "Current streak", color: "#ef4444" },
              ].map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: 18 }}>{s.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{s.val} <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{s.sub}</span></div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Strengths + Focus Areas ── */}
          <div className="pg-grid-eq">
            <div className="pg-card">
              <p className="pg-card-title">⭐ Your Strengths</p>
              {strengths.length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>Complete more sessions to reveal your strengths.</p>
              ) : (
                strengths.map((m) => {
                  const b = masteryBadge(m.mastery_level);
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13.5, color: "#0f172a", fontWeight: 500 }}>{m.topic} <span style={{ fontSize: 11, color: "#94a3b8" }}>· {m.subject}</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: b.color, background: b.bg, padding: "2px 10px", borderRadius: 999 }}>{b.label}</span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pg-card">
              <p className="pg-card-title">🎯 Focus Areas</p>
              {focusAreas.length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>Great job — no urgent focus areas right now!</p>
              ) : (
                focusAreas.map((m) => {
                  const b = masteryBadge(m.mastery_level);
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13.5, color: "#0f172a", fontWeight: 500 }}>{m.topic} <span style={{ fontSize: 11, color: "#94a3b8" }}>· {m.subject}</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: b.color, background: b.bg, padding: "2px 10px", borderRadius: 999 }}>{b.label}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Your Subjects + Your Improvement ── */}
          <div className="pg-grid-eq">
            <div className="pg-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <p className="pg-card-title" style={{ margin: 0 }}>📘 Your Subjects</p>
                <button onClick={() => navigate("/lesson/setup")} style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>View all subjects →</button>
              </div>
              {subjectStats.length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>No subject data yet. Start a few sessions to track progress.</p>
              ) : (
                subjectStats.slice(0, 4).map((s) => {
                  const pal = getSubjectPalette(s.subject);
                  const c = subjectSkillCounts(mastery, s.subject);
                  return (
                    <div key={s.subject} style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: pal.bg, border: `1.5px solid ${pal.color}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{pal.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{s.subject}</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: pal.color }}>{s.percent}%</span>
                          </div>
                          <div style={{ height: 7, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", marginTop: 5 }}>
                            <div style={{ height: "100%", width: `${s.percent}%`, background: pal.color, borderRadius: 999 }} />
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#94a3b8", paddingLeft: 44 }}>
                        {c.strong} strong · {c.developing} developing · {c.needPractice} need practice
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pg-card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                <p className="pg-card-title" style={{ margin: 0 }}>📈 Your Improvement</p>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Quiz accuracy</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{accuracyPercent !== null ? `${accuracyPercent}%` : "—"}</span>
                {improvementDelta !== 0 && (
                  <span style={{ fontSize: 13, fontWeight: 800, color: improvementDelta > 0 ? "#16a34a" : "#dc2626" }}>
                    {improvementDelta > 0 ? "↑ +" : "↓ "}{Math.abs(improvementDelta)}% <span style={{ color: "#94a3b8", fontWeight: 600 }}>this month</span>
                  </span>
                )}
              </div>

              {/* Bar chart — kept simple and fully inside the card */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 120, marginTop: 12, paddingBottom: 22, position: "relative" }}>
                {weeklyScores.map((score, i) => {
                  const isNull = score === null;
                  const pct = isNull ? 0 : score;
                  const barH = pct > 0 ? Math.max(6, (pct / 100) * 92) : 4;
                  const isThis = i === 3;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4, position: "relative" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isNull ? "#cbd5e1" : isThis ? "#3b82f6" : "#64748b" }}>{isNull ? "—" : `${pct}%`}</span>
                      <div style={{ width: "100%", maxWidth: 46, height: `${barH}px`, background: isNull ? "#e2e8f0" : isThis ? "#3b82f6" : "#bfdbfe", borderRadius: "5px 5px 0 0", transition: "height 0.4s ease" }} />
                      <span style={{ position: "absolute", bottom: 0, fontSize: 10.5, color: isThis ? "#3b82f6" : "#94a3b8", fontWeight: isThis ? 700 : 500 }}>{weekLabels[i]}</span>
                    </div>
                  );
                })}
              </div>
              {improvementDelta > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "8px 12px", marginTop: 8 }}>
                  <span style={{ fontSize: 15 }}>📈</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#166534", lineHeight: 1.4 }}>
                    Great progress — your accuracy is up {improvementDelta}% over the last few weeks!
                  </span>
                </div>
              ) : (
                <p style={{ fontSize: 11.5, color: "#94a3b8", margin: "8px 0 0", lineHeight: 1.4 }}>
                  Average quiz accuracy per calendar week (Mon–Sun).
                </p>
              )}
            </div>
          </div>

          {/* ── Your Goal ── */}
          <div className="pg-card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <p className="pg-card-title" style={{ margin: 0 }}>🚩 Your Goal</p>
              <button onClick={() => navigate("/lesson/setup")} style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Edit goal →</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div style={{ flex: "2 1 260px" }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>
                  Become confident in {primarySubject ? primarySubject.subject : weakestSubject}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Current</div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#d97706", background: "#fffbeb", padding: "4px 12px", borderRadius: 999 }}>Developing</span>
                  </div>
                  <ArrowRight size={18} color="#94a3b8" />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Target</div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", padding: "4px 12px", borderRadius: 999 }}>Secure</span>
                  </div>
                </div>
              </div>
              <div style={{ flex: "3 1 300px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{masteredCount} of {totalTopics || 0} skills secure</span>
                </div>
                <div style={{ height: 9, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ height: "100%", width: `${totalTopics > 0 ? Math.round((masteredCount / totalTopics) * 100) : 0}%`, background: "linear-gradient(90deg,#10b981,#3b82f6)", borderRadius: 999 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, color: "#64748b" }}>🗓️ {WEEKLY_GOAL} sessions per week</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{sessionsThisWeek}/{WEEKLY_GOAL}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom CTA ── */}
          <div style={{ background: "linear-gradient(120deg,#eef2ff,#f0fdf4)", border: "1px solid #e2e8f0", borderRadius: 14, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <img src="/images/robot-happy.png" alt="" draggable={false} style={{ height: 56, width: "auto", objectFit: "contain", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>Ready to improve your next skill?</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>Let's keep the momentum going with a personalised practice session.</div>
            </div>
            <button
              onClick={() => recFocus ? navigate("/lesson/setup", { state: { subject: recFocus.subject, topic: recFocus.topic, goal: "revision" } }) : navigate("/lesson/setup")}
              style={{ background: "linear-gradient(135deg,#1a73e8,#4f46e5)", color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
            >
              Start Recommended Practice <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
  );
}
