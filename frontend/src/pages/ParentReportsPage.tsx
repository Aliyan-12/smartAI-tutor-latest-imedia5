import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";

interface ReportData {
  appointment_id: number;
  status: string;
  subject: string;
  report: {
    summary: string;
    topics_covered: string[];
    quiz_score_percent: number | null;
    weak_areas: string[];
    strong_areas: string[];
    understanding_level: string;
    next_session_recommendation: string;
    time_spent_minutes: number;
    encouragement?: string;
  } | null;
}

const SUBJECT_CONFIG: Record<string, { emoji: string; color: string; bg: string }> = {
  maths:     { emoji: "📐", color: "#2563eb", bg: "#eff6ff" },
  math:      { emoji: "📐", color: "#2563eb", bg: "#eff6ff" },
  science:   { emoji: "🔬", color: "#16a34a", bg: "#f0fdf4" },
  english:   { emoji: "📖", color: "#7c3aed", bg: "#f5f3ff" },
  history:   { emoji: "🏛️", color: "#d97706", bg: "#fffbeb" },
  geography: { emoji: "🌍", color: "#0891b2", bg: "#ecfeff" },
  computing: { emoji: "💻", color: "#4f46e5", bg: "#eef2ff" },
  physics:   { emoji: "⚛️", color: "#0284c7", bg: "#f0f9ff" },
  chemistry: { emoji: "🧪", color: "#059669", bg: "#ecfdf5" },
  biology:   { emoji: "🧬", color: "#15803d", bg: "#f0fdf4" },
  music:     { emoji: "🎵", color: "#db2777", bg: "#fdf2f8" },
  art:       { emoji: "🎨", color: "#ea580c", bg: "#fff7ed" },
  default:   { emoji: "📚", color: "#475569", bg: "#f8fafc" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  completed:  { label: "Completed",   color: "#15803d", bg: "#dcfce7", icon: "✓" },
  terminated: { label: "Terminated",  color: "#6b7280", bg: "#f3f4f6", icon: "✕" },
  started:    { label: "In Progress", color: "#2563eb", bg: "#dbeafe", icon: "▶" },
  paused:     { label: "Paused",      color: "#d97706", bg: "#fef3c7", icon: "⏸" },
  confirmed:  { label: "Confirmed",   color: "#7c3aed", bg: "#f5f3ff", icon: "✔" },
  booked:     { label: "Booked",      color: "#0891b2", bg: "#ecfeff", icon: "📅" },
  cancelled:  { label: "Cancelled",   color: "#dc2626", bg: "#fee2e2", icon: "✕" },
};

const STATUS_FILTER_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "completed",  label: "Completed" },
  { value: "terminated", label: "Terminated" },
  { value: "started",    label: "In Progress" },
  { value: "paused",     label: "Paused" },
  { value: "confirmed",  label: "Confirmed" },
];

function getSubjectCfg(subject: string) {
  return SUBJECT_CONFIG[subject?.toLowerCase()] ?? SUBJECT_CONFIG.default;
}

function getStatusCfg(status: string) {
  return STATUS_CONFIG[status?.toLowerCase()] ?? { label: status, color: "#475569", bg: "#f1f5f9", icon: "" };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const canViewReport = (status: string) => ["completed", "terminated"].includes(status);

export default function ParentReportsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSubject, setActiveSubject] = useState<string>("All");
  const [activeStatus, setActiveStatus] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [reportData, setReportData] = useState<Record<number, ReportData | null>>({});
  const [reportLoading, setReportLoading] = useState<Record<number, boolean>>({});

  useEffect(() => {
    appointmentsApi
      .list()
      .then((data) => setAppointments((data as Appointment[]) ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const subjects = ["All", ...Array.from(new Set(appointments.map((a) => a.subject))).sort()];

  const displayed = appointments.filter((a) => {
    const subjMatch = activeSubject === "All" || a.subject === activeSubject;
    const statusMatch = activeStatus === "all" || a.status === activeStatus;
    return subjMatch && statusMatch;
  });

  const loadReport = useCallback(
    async (id: number) => {
      if (reportData[id] !== undefined) return;
      setReportLoading((prev) => ({ ...prev, [id]: true }));
      try {
        const data = await appointmentsApi.getReport(id);
        setReportData((prev) => ({ ...prev, [id]: data as ReportData }));
      } catch {
        setReportData((prev) => ({ ...prev, [id]: null }));
      } finally {
        setReportLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [reportData]
  );

  const handleToggle = (id: number) => {
    const nowOpen = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: nowOpen }));
    if (nowOpen) loadReport(id);
  };

  return (
    <>
      <style>{`
        .pr-page { display: flex; height: 100vh; background: #f8fafc; font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .pr-main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .pr-header { padding: 32px 40px 0; }
        .pr-title { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
        .pr-subtitle { font-size: 14px; color: #64748b; margin: 0; }
        .pr-filter-group { padding: 20px 40px 0; display: flex; flex-direction: column; gap: 10px; }
        .pr-filter-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin: 0; }
        .pr-filters { display: flex; gap: 8px; flex-wrap: wrap; }
        .pr-chip {
          padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600;
          cursor: pointer; border: 1.5px solid #e2e8f0; background: white; color: #475569;
          transition: all .15s;
        }
        .pr-chip:hover { border-color: #1a73e8; color: #1a73e8; }
        .pr-chip.active { background: #1a73e8; color: white; border-color: #1a73e8; }
        .pr-body { flex: 1; padding: 20px 40px 40px; display: flex; flex-direction: column; gap: 14px; }
        .pr-card {
          background: white; border-radius: 12px; border: 1.5px solid #e2e8f0;
          overflow: hidden; transition: box-shadow .15s;
        }
        .pr-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.07); }
        .pr-card-top { display: flex; align-items: flex-start; gap: 16px; padding: 18px 24px; }
        .pr-subject-icon {
          width: 44px; height: 44px; border-radius: 10px; display: flex;
          align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
        }
        .pr-card-info { flex: 1; min-width: 0; }
        .pr-card-meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
        .pr-subject-badge {
          padding: 3px 10px; border-radius: 999px; font-size: 11px;
          font-weight: 700; letter-spacing: .3px;
        }
        .pr-card-title { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 5px; }
        .pr-card-details { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .pr-detail-item { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; }
        .pr-card-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
        .pr-view-btn {
          padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
          background: #1a73e8; color: white; border: none; cursor: pointer;
          transition: background .15s; white-space: nowrap;
        }
        .pr-view-btn:hover { background: #1557b0; }
        .pr-view-btn.open { background: #f1f5f9; color: #475569; border: 1.5px solid #e2e8f0; }
        .pr-view-btn.open:hover { background: #e2e8f0; }
        .pr-no-report-btn {
          padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600;
          background: #f8fafc; color: #94a3b8; border: 1.5px solid #e2e8f0; cursor: default;
          white-space: nowrap;
        }
        .pr-report-panel {
          border-top: 1.5px solid #f1f5f9; background: #fafafa;
          padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;
        }
        .pr-report-section-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 8px; }
        .pr-perf-text { font-size: 14px; color: #374151; line-height: 1.7; margin: 0; }
        .pr-list { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
        .pr-list-item { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; color: #374151; }
        .pr-bullet { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
        .pr-recs-box { background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 12px 14px; }
        .pr-recs-text { font-size: 13px; color: #1e40af; line-height: 1.6; margin: 0; }
        .pr-topics-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .pr-topic-chip {
          padding: 3px 10px; border-radius: 999px; background: #f1f5f9;
          border: 1px solid #e2e8f0; font-size: 12px; font-weight: 600; color: #475569;
        }
        .pr-engagement-badge { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .pr-report-row { display: flex; gap: 24px; flex-wrap: wrap; }
        .pr-report-col { flex: 1; min-width: 200px; }
        .pr-quiz-score-row { display: flex; align-items: center; gap: 10px; }
        .pr-quiz-score-val { font-size: 28px; font-weight: 800; color: #0f172a; }
        .pr-quiz-score-label { font-size: 12px; color: #64748b; }
        .pr-no-report { text-align: center; padding: 16px; color: #94a3b8; font-size: 13px; font-style: italic; }
        .pr-spinner {
          width: 26px; height: 26px; border: 3px solid #e2e8f0;
          border-top-color: #1a73e8; border-radius: 50%; animation: pr-spin .8s linear infinite;
          margin: 16px auto;
        }
        .pr-empty {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 10px; padding: 80px 20px; text-align: center;
        }
        .pr-empty-icon { font-size: 52px; }
        .pr-empty h3 { margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; }
        .pr-empty p { margin: 0; font-size: 14px; color: #64748b; max-width: 380px; }
        .pr-loading {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px;
          color: #64748b; font-size: 14px;
        }
        .pr-page-spinner {
          width: 32px; height: 32px; border: 3px solid #e2e8f0;
          border-top-color: #1a73e8; border-radius: 50%; animation: pr-spin .8s linear infinite;
        }
        @keyframes pr-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="pr-page">
        <Sidebar />

        <div className="pr-main">
          <div className="pr-header">
            <h1 className="pr-title">Session Reports</h1>
            <p className="pr-subtitle">AI-generated reports from your children's learning sessions.</p>
          </div>

          {!loading && !error && (
            <div className="pr-filter-group">
              <div>
                <p className="pr-filter-label">Status</p>
                <div className="pr-filters">
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`pr-chip${activeStatus === opt.value ? " active" : ""}`}
                      onClick={() => setActiveStatus(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {subjects.length > 1 && (
                <div>
                  <p className="pr-filter-label">Subject</p>
                  <div className="pr-filters">
                    {subjects.map((s) => (
                      <button
                        key={s}
                        className={`pr-chip${activeSubject === s ? " active" : ""}`}
                        onClick={() => setActiveSubject(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pr-body">
            {loading && (
              <div className="pr-loading">
                <div className="pr-page-spinner" />
                <span>Loading sessions...</span>
              </div>
            )}

            {!loading && error && (
              <div className="pr-empty">
                <div className="pr-empty-icon">⚠️</div>
                <h3>Could not load sessions</h3>
                <p>{error}</p>
              </div>
            )}

            {!loading && !error && displayed.length === 0 && (
              <div className="pr-empty">
                <div className="pr-empty-icon">📋</div>
                <h3>No sessions found</h3>
                <p>Sessions will appear here once your child has booked or completed a tutoring session.</p>
              </div>
            )}

            {!loading && !error && displayed.map((appt) => {
              const cfg = getSubjectCfg(appt.subject);
              const stCfg = getStatusCfg(appt.status);
              const isOpen = !!expanded[appt.id];
              const isLoadingReport = !!reportLoading[appt.id];
              const report = reportData[appt.id];
              const reportable = canViewReport(appt.status);

              return (
                <div key={appt.id} className="pr-card">
                  <div className="pr-card-top">
                    <div className="pr-subject-icon" style={{ background: cfg.bg }}>
                      {cfg.emoji}
                    </div>

                    <div className="pr-card-info">
                      <div className="pr-card-meta-row">
                        <span className="pr-subject-badge" style={{ background: cfg.bg, color: cfg.color }}>
                          {appt.subject}
                        </span>
                        <span className="pr-subject-badge" style={{ background: stCfg.bg, color: stCfg.color }}>
                          {stCfg.icon} {stCfg.label}
                        </span>
                      </div>
                      <p className="pr-card-title">{appt.title}</p>
                      <div className="pr-card-details">
                        <span className="pr-detail-item">📅 {formatDate(appt.scheduled_at)}</span>
                        <span className="pr-detail-item">🕐 {formatTime(appt.scheduled_at)}</span>
                        <span className="pr-detail-item">⏱ {appt.duration_minutes} min</span>
                        {appt.key_stage && <span className="pr-detail-item">🎓 {appt.key_stage}</span>}
                        {appt.student_name && <span className="pr-detail-item">👤 {appt.student_name}</span>}
                      </div>
                    </div>

                    <div className="pr-card-actions">
                      {reportable ? (
                        <button
                          className={`pr-view-btn${isOpen ? " open" : ""}`}
                          onClick={() => handleToggle(appt.id)}
                        >
                          {isOpen ? "Hide Report ▲" : "View Report ▼"}
                        </button>
                      ) : (
                        <span className="pr-no-report-btn">
                          {appt.status === "started" ? "Session in progress" :
                           appt.status === "paused" ? "Session paused" :
                           appt.status === "confirmed" ? "Not started yet" : "No report"}
                        </span>
                      )}
                    </div>
                  </div>

                  {isOpen && reportable && (
                    <div className="pr-report-panel">
                      {isLoadingReport && <div className="pr-spinner" />}

                      {!isLoadingReport && report === null && (
                        <p className="pr-no-report">
                          Report not yet generated for this session. Check back after the session has been fully processed.
                        </p>
                      )}

                      {!isLoadingReport && report && report.report === null && (
                        <p className="pr-no-report">
                          Report not yet generated for this session. Check back after the session has been fully processed.
                        </p>
                      )}

                      {!isLoadingReport && report && report.report && (() => {
                        const r = report.report;
                        const engCfg = getStatusCfg(r.understanding_level?.toLowerCase() === "excellent" ? "completed"
                          : r.understanding_level?.toLowerCase() === "good" ? "started"
                          : r.understanding_level?.toLowerCase() === "developing" ? "paused"
                          : "cancelled");
                        return (
                          <>
                            <div>
                              <p className="pr-report-section-title">Session Summary</p>
                              <p className="pr-perf-text">{r.summary}</p>
                            </div>

                            <div className="pr-report-row">
                              {r.quiz_score_percent != null && (
                                <div className="pr-report-col" style={{ flex: "0 0 auto" }}>
                                  <p className="pr-report-section-title">Quiz Score</p>
                                  <div className="pr-quiz-score-row">
                                    <span className="pr-quiz-score-val">{Math.round(r.quiz_score_percent)}%</span>
                                    <span className="pr-quiz-score-label">correct</span>
                                  </div>
                                </div>
                              )}
                              {r.understanding_level && (
                                <div className="pr-report-col" style={{ flex: "0 0 auto" }}>
                                  <p className="pr-report-section-title">Understanding Level</p>
                                  <span
                                    className="pr-engagement-badge"
                                    style={{ background: engCfg.bg, color: engCfg.color }}
                                  >
                                    {r.understanding_level}
                                  </span>
                                </div>
                              )}
                              {r.topics_covered && r.topics_covered.length > 0 && (
                                <div className="pr-report-col">
                                  <p className="pr-report-section-title">Topics Covered</p>
                                  <div className="pr-topics-row">
                                    {r.topics_covered.map((t, i) => (
                                      <span key={i} className="pr-topic-chip">{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="pr-report-row">
                              <div className="pr-report-col">
                                <p className="pr-report-section-title">Strong Areas</p>
                                <ul className="pr-list">
                                  {(r.strong_areas ?? []).map((s, i) => (
                                    <li key={i} className="pr-list-item">
                                      <span className="pr-bullet" style={{ background: "#16a34a" }} />
                                      {s}
                                    </li>
                                  ))}
                                  {(!r.strong_areas || r.strong_areas.length === 0) && (
                                    <li className="pr-list-item" style={{ color: "#94a3b8" }}>None recorded</li>
                                  )}
                                </ul>
                              </div>

                              <div className="pr-report-col">
                                <p className="pr-report-section-title">Areas to Improve</p>
                                <ul className="pr-list">
                                  {(r.weak_areas ?? []).map((s, i) => (
                                    <li key={i} className="pr-list-item">
                                      <span className="pr-bullet" style={{ background: "#d97706" }} />
                                      {s}
                                    </li>
                                  ))}
                                  {(!r.weak_areas || r.weak_areas.length === 0) && (
                                    <li className="pr-list-item" style={{ color: "#94a3b8" }}>None recorded</li>
                                  )}
                                </ul>
                              </div>
                            </div>

                            {r.next_session_recommendation && (
                              <div>
                                <p className="pr-report-section-title">Next Session Recommendation</p>
                                <div className="pr-recs-box">
                                  <p className="pr-recs-text">{r.next_session_recommendation}</p>
                                </div>
                              </div>
                            )}

                            {r.encouragement && (
                              <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "10px 14px" }}>
                                <p style={{ fontSize: 13, color: "#15803d", margin: 0, fontWeight: 600 }}>
                                  💬 {r.encouragement}
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
