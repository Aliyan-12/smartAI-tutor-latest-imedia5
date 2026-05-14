import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";

const SUBJECT_CONFIG: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  maths:              { icon: "🧮", color: "#f97316", bg: "#fff7ed", border: "#fed7aa" },
  mathematics:        { icon: "🧮", color: "#f97316", bg: "#fff7ed", border: "#fed7aa" },
  science:            { icon: "🔬", color: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0" },
  biology:            { icon: "🧬", color: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0" },
  chemistry:          { icon: "⚗️", color: "#ec4899", bg: "#fdf2f8", border: "#f9a8d4" },
  physics:            { icon: "⚛️", color: "#06b6d4", bg: "#ecfeff", border: "#a5f3fc" },
  english:            { icon: "📚", color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
  history:            { icon: "🏛️", color: "#a855f7", bg: "#faf5ff", border: "#d8b4fe" },
  geography:          { icon: "🌍", color: "#10b981", bg: "#ecfdf5", border: "#a7f3d0" },
  art:                { icon: "🎨", color: "#f59e0b", bg: "#fffbeb", border: "#fcd34d" },
  "computer science": { icon: "💻", color: "#6366f1", bg: "#eef2ff", border: "#a5b4fc" },
  computing:          { icon: "💻", color: "#6366f1", bg: "#eef2ff", border: "#a5b4fc" },
  ict:                { icon: "💻", color: "#6366f1", bg: "#eef2ff", border: "#a5b4fc" },
};

function getSubjectConfig(subject: string) {
  return SUBJECT_CONFIG[subject.toLowerCase()] ?? { icon: "📖", color: "#64748b", bg: "#f8fafc", border: "#e2e8f0" };
}

function getSubjectIcon(subject: string): string {
  return getSubjectConfig(subject).icon;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  booked:     { label: "BOOKED",      bg: "#fff7ed", color: "#ea580c" },
  confirmed:  { label: "CONFIRMED",   bg: "#f0fdf4", color: "#16a34a" },
  started:    { label: "IN PROGRESS", bg: "#eef2ff", color: "#6366f1" },
  paused:     { label: "PAUSED",      bg: "#fffbeb", color: "#d97706" },
  terminated: { label: "TERMINATED",  bg: "#f8fafc", color: "#64748b" },
  completed:  { label: "COMPLETED",   bg: "#f8fafc", color: "#64748b" },
  cancelled:  { label: "CANCELLED",   bg: "#fef2f2", color: "#dc2626" },
};

function formatDateUK(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getScorePercent(a: Appointment): number | null {
  return null;
}

interface SessionCardProps {
  appointment: Appointment;
  expanded: boolean;
  onToggle: () => void;
}

function SessionCard({ appointment: a, expanded, onToggle }: SessionCardProps) {
  const navigate = useNavigate();
  const sc = getSubjectConfig(a.subject);
  const st = STATUS_CONFIG[a.status] ?? { label: a.status.toUpperCase(), bg: "#f8fafc", color: "#64748b" };
  const score = getScorePercent(a);
  const isActive = ["confirmed", "started", "paused"].includes(a.status);

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${sc.border}`,
        borderRadius: 12,
        marginBottom: 10,
        overflow: "hidden",
        boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
        borderLeft: `4px solid ${isActive ? sc.color : sc.border}`,
        transition: "box-shadow 0.18s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 18px",
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: sc.bg,
            border: `1.5px solid ${sc.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {sc.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{a.title}</span>
            <span
              style={{
                padding: "2px 9px",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.5px",
                background: st.bg,
                color: st.color,
                border: `1px solid ${st.color}22`,
              }}
            >
              {st.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{
              background: sc.bg,
              color: sc.color,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              border: `1px solid ${sc.border}`,
            }}>{a.subject}</span>
            {a.key_stage && <span>· {a.key_stage}</span>}
            {a.duration_minutes && <span>· {a.duration_minutes} min</span>}
            <span>· {formatDateUK(a.scheduled_at)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          {score !== null && (
            <div style={{ textAlign: "right", minWidth: 80 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 3 }}>{score}%</div>
              <div
                style={{
                  height: 5,
                  width: 80,
                  background: "#e2e8f0",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${score}%`,
                    background: score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444",
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            style={{
              background: "none",
              border: "1px solid #e2e8f0",
              borderRadius: 7,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              color: "#475569",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {expanded ? "Hide" : "View →"}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid #f1f5f9",
            padding: "14px 18px",
            background: "#fafbfc",
          }}
        >
          {a.description && (
            <p style={{ fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 1.6 }}>
              {a.description}
            </p>
          )}
          {a.notes && (
            <p style={{ fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 1.6 }}>
              <strong>Notes:</strong> {a.notes}
            </p>
          )}
          {!a.description && !a.notes && (
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>
              No session summary available yet.
            </p>
          )}
          {["confirmed", "started", "paused"].includes(a.status) && (
            <button
              className="btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => navigate(`/session/${a.id}`)}
            >
              {a.status === "started" ? "Rejoin Session" : a.status === "paused" ? "Resume Session" : "Join Session"}
            </button>
          )}
          {["terminated", "completed"].includes(a.status) && (
            <button
              className="btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => navigate(`/session/${a.id}/report`)}
            >
              📊 View Session Report
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SessionsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"recent" | "all">("recent");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCount, setShowCount] = useState(5);
  const [tipDismissed, setTipDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    appointmentsApi
      .list()
      .then((data) => setAppointments(data as Appointment[]))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const subjects = Array.from(new Set(appointments.map((a) => a.subject))).sort();

  const continueLearning = appointments.find(
    (a) => ["confirmed", "started", "paused"].includes(a.status)
  );

  const filtered = appointments.filter((a) => {
    if (subjectFilter && a.subject !== subjectFilter) return false;
    if (tab === "recent") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      return new Date(a.scheduled_at) >= cutoff || a.status === "confirmed" || a.status === "booked";
    }
    return true;
  });

  const visible = filtered.slice(0, showCount);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div style={{
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            borderRadius: 16,
            padding: "20px 24px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: -15, right: 60, width: 90, height: 90, borderRadius: "50%", background: "rgba(255,255,255,0.07)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: -25, right: 20, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0 }}>📅 My Sessions</h1>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", margin: "4px 0 0" }}>
                Your learning journey, all in one place.
              </p>
            </div>
            <img
              src="/images/classroom-robot.png"
              alt="Classroom robot"
              draggable={false}
              style={{
                width: 110,
                height: "auto",
                position: "absolute",
                right: 20,
                bottom: 0,
                pointerEvents: "none",
                objectFit: "contain",
                zIndex: 1,
              }}
            />
          </div>

          {loading && (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <div className="typing-indicator" style={{ justifyContent: "center" }}>
                <span /><span /><span />
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {continueLearning && (() => {
                const clSc = getSubjectConfig(continueLearning.subject);
                return (
                <div
                  style={{
                    background: `linear-gradient(135deg, ${clSc.bg}, white)`,
                    border: `1.5px solid ${clSc.border}`,
                    borderLeft: `5px solid ${clSc.color}`,
                    borderRadius: 14,
                    padding: "16px 20px",
                    marginBottom: 20,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    flexWrap: "wrap",
                    boxShadow: `0 4px 16px ${clSc.color}14`,
                  }}
                >
                  <img
                    src={
                      ["science", "biology", "chemistry", "physics"].includes(
                        continueLearning.subject.toLowerCase()
                      )
                        ? "/images/sci-robot.png"
                        : "/images/teaching-robot.png"
                    }
                    alt="Subject robot"
                    draggable={false}
                    style={{
                      width: 52,
                      height: 52,
                      objectFit: "contain",
                      flexShrink: 0,
                      pointerEvents: "none",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", marginBottom: 3 }}>
                      {continueLearning.title}
                    </div>
                    <div style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ background: clSc.bg, color: clSc.color, fontWeight: 700, padding: "2px 8px", borderRadius: 999, fontSize: 11, border: `1px solid ${clSc.border}` }}>
                        {continueLearning.subject}
                      </span>
                      {continueLearning.key_stage && <span style={{ color: "#64748b" }}>{continueLearning.key_stage}</span>}
                      <span
                        style={{
                          background: STATUS_CONFIG[continueLearning.status]?.bg,
                          color: STATUS_CONFIG[continueLearning.status]?.color,
                          padding: "1px 7px",
                          borderRadius: 999,
                          fontWeight: 700,
                          fontSize: 10,
                          letterSpacing: "0.4px",
                        }}
                      >
                        {STATUS_CONFIG[continueLearning.status]?.label}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                    <button
                      className="btn-primary"
                      style={{ fontSize: 13 }}
                      onClick={() => navigate(`/session/${continueLearning.id}`)}
                    >
                      Resume Lesson
                    </button>
                    <button
                      style={{
                        fontSize: 13,
                        padding: "7px 14px",
                        background: "white",
                        border: `1px solid ${clSc.border}`,
                        borderRadius: 8,
                        color: clSc.color,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                      onClick={() =>
                        setExpandedId((prev) =>
                          prev === continueLearning.id ? null : continueLearning.id
                        )
                      }
                    >
                      Lesson Details
                    </button>
                  </div>
                </div>
                );
              })()}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e2e8f0" }}>
                  {(["recent", "all"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setTab(t); setShowCount(5); }}
                      style={{
                        padding: "8px 18px",
                        background: "none",
                        border: "none",
                        borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
                        marginBottom: -2,
                        fontSize: 13,
                        fontWeight: tab === t ? 700 : 500,
                        color: tab === t ? "#3b82f6" : "#64748b",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t === "recent" ? "Recent Sessions" : "All Sessions"}
                    </button>
                  ))}
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <select
                    value={subjectFilter}
                    onChange={(e) => { setSubjectFilter(e.target.value); setShowCount(5); }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      fontSize: 13,
                      color: "#475569",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">All Subjects</option>
                    {subjects.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setLoading(true);
                      appointmentsApi
                        .list()
                        .then((data) => setAppointments(data as Appointment[]))
                        .catch((e) => setError(e.message))
                        .finally(() => setLoading(false));
                    }}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 7,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      fontSize: 13,
                      color: "#475569",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 24px",
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
                  <p style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 6 }}>
                    No sessions booked yet
                  </p>
                  <p style={{ fontSize: 13, color: "#64748b", maxWidth: 340, margin: "0 auto" }}>
                    Ask your parent to book an AI tutoring session for you to get started on your learning journey.
                  </p>
                </div>
              ) : (
                <>
                  {visible.map((a) => (
                    <SessionCard
                      key={a.id}
                      appointment={a}
                      expanded={expandedId === a.id}
                      onToggle={() => setExpandedId((prev) => (prev === a.id ? null : a.id))}
                    />
                  ))}
                  {filtered.length > showCount && (
                    <div style={{ textAlign: "center", marginTop: 8 }}>
                      <button
                        onClick={() => setShowCount((c) => c + 5)}
                        style={{
                          padding: "8px 22px",
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          background: "#fff",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#475569",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Show More Sessions
                      </button>
                    </div>
                  )}
                </>
              )}

              {!tipDismissed && (
                <div
                  style={{
                    marginTop: 24,
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
                    "Reviewing past sessions helps you remember better and learn faster!"
                  </p>
                  <button
                    onClick={() => setTipDismissed(true)}
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
                    Got it
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
