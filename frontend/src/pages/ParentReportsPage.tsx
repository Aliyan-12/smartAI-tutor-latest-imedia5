import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";

interface ReportData {
  appointment_id: number;
  status: string;
  subject: string;
  report: {
    overall_performance: string;
    strengths: string[];
    areas_for_improvement: string[];
    recommendations: string;
    engagement_level: string;
    topics_covered: string[];
  } | null;
}

const SUBJECT_CONFIG: Record<string, { emoji: string; color: string; bg: string }> = {
  maths:   { emoji: "📐", color: "#2563eb", bg: "#eff6ff" },
  math:    { emoji: "📐", color: "#2563eb", bg: "#eff6ff" },
  science: { emoji: "🔬", color: "#16a34a", bg: "#f0fdf4" },
  english: { emoji: "📖", color: "#7c3aed", bg: "#f5f3ff" },
  history: { emoji: "🏛️", color: "#d97706", bg: "#fffbeb" },
  geography: { emoji: "🌍", color: "#0891b2", bg: "#ecfeff" },
  computing: { emoji: "💻", color: "#4f46e5", bg: "#eef2ff" },
  physics:   { emoji: "⚛️", color: "#0284c7", bg: "#f0f9ff" },
  chemistry: { emoji: "🧪", color: "#059669", bg: "#ecfdf5" },
  biology:   { emoji: "🧬", color: "#15803d", bg: "#f0fdf4" },
  music:     { emoji: "🎵", color: "#db2777", bg: "#fdf2f8" },
  art:       { emoji: "🎨", color: "#ea580c", bg: "#fff7ed" },
  default:   { emoji: "📚", color: "#475569", bg: "#f8fafc" },
};

const ENGAGEMENT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  excellent:     { label: "Excellent", color: "#15803d", bg: "#dcfce7" },
  good:          { label: "Good",      color: "#2563eb", bg: "#dbeafe" },
  average:       { label: "Average",   color: "#d97706", bg: "#fef3c7" },
  needs_support: { label: "Needs Support", color: "#dc2626", bg: "#fee2e2" },
  low:           { label: "Low",       color: "#dc2626", bg: "#fee2e2" },
};

function getSubjectCfg(subject: string) {
  return SUBJECT_CONFIG[subject.toLowerCase()] ?? SUBJECT_CONFIG.default;
}

function getEngagementCfg(level: string) {
  return ENGAGEMENT_CONFIG[level.toLowerCase()] ?? { label: level, color: "#475569", bg: "#f1f5f9" };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function ParentReportsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSubject, setActiveSubject] = useState<string>("All");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [reportData, setReportData] = useState<Record<number, ReportData | null>>({});
  const [reportLoading, setReportLoading] = useState<Record<number, boolean>>({});

  useEffect(() => {
    appointmentsApi
      .list("completed")
      .then((data) => setAppointments((data as Appointment[]) ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const subjects = ["All", ...Array.from(new Set(appointments.map((a) => a.subject))).sort()];

  const displayed =
    activeSubject === "All"
      ? appointments
      : appointments.filter((a) => a.subject === activeSubject);

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
        .pr-filters { display: flex; gap: 8px; flex-wrap: wrap; padding: 24px 40px 0; }
        .pr-chip {
          padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600;
          cursor: pointer; border: 1.5px solid #e2e8f0; background: white; color: #475569;
          transition: all .15s;
        }
        .pr-chip:hover { border-color: #1a73e8; color: #1a73e8; }
        .pr-chip.active { background: #1a73e8; color: white; border-color: #1a73e8; }
        .pr-body { flex: 1; padding: 24px 40px; display: flex; flex-direction: column; gap: 16px; }
        .pr-card {
          background: white; border-radius: 12px; border: 1.5px solid #e2e8f0;
          overflow: hidden; transition: box-shadow .15s;
        }
        .pr-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.07); }
        .pr-card-top { display: flex; align-items: flex-start; gap: 16px; padding: 20px 24px; }
        .pr-subject-icon {
          width: 46px; height: 46px; border-radius: 10px; display: flex;
          align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;
        }
        .pr-card-info { flex: 1; min-width: 0; }
        .pr-card-meta-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
        .pr-subject-badge {
          padding: 3px 10px; border-radius: 999px; font-size: 11px;
          font-weight: 700; letter-spacing: .3px;
        }
        .pr-card-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 6px; }
        .pr-card-details { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .pr-detail-item { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; }
        .pr-view-btn {
          padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 700;
          background: #1a73e8; color: white; border: none; cursor: pointer;
          transition: background .15s; white-space: nowrap; align-self: flex-start;
        }
        .pr-view-btn:hover { background: #1557b0; }
        .pr-view-btn.open { background: #f1f5f9; color: #475569; border: 1.5px solid #e2e8f0; }
        .pr-view-btn.open:hover { background: #e2e8f0; }
        .pr-report-panel {
          border-top: 1.5px solid #f1f5f9; background: #fafafa;
          padding: 24px; display: flex; flex-direction: column; gap: 18px;
        }
        .pr-report-section-title { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 8px; }
        .pr-perf-text { font-size: 14px; color: #374151; line-height: 1.7; margin: 0; }
        .pr-list { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
        .pr-list-item { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 1.5; color: #374151; }
        .pr-bullet { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
        .pr-recs-box {
          background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px;
          padding: 14px 16px;
        }
        .pr-recs-text { font-size: 14px; color: #1e40af; line-height: 1.6; margin: 0; }
        .pr-topics-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .pr-topic-chip {
          padding: 4px 12px; border-radius: 999px; background: #f1f5f9;
          border: 1px solid #e2e8f0; font-size: 12px; font-weight: 600; color: #475569;
        }
        .pr-engagement-badge {
          padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700;
        }
        .pr-report-row { display: flex; gap: 32px; flex-wrap: wrap; }
        .pr-report-col { flex: 1; min-width: 220px; }
        .pr-no-report {
          text-align: center; padding: 20px; color: #94a3b8; font-size: 14px;
          font-style: italic;
        }
        .pr-spinner {
          width: 28px; height: 28px; border: 3px solid #e2e8f0;
          border-top-color: #1a73e8; border-radius: 50%; animation: pr-spin .8s linear infinite;
          margin: 20px auto;
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
            <p className="pr-subtitle">AI-generated reports from your children's completed learning sessions.</p>
          </div>

          {!loading && !error && appointments.length > 0 && (
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
          )}

          <div className="pr-body">
            {loading && (
              <div className="pr-loading">
                <div className="pr-page-spinner" />
                <span>Loading session reports...</span>
              </div>
            )}

            {!loading && error && (
              <div className="pr-empty">
                <div className="pr-empty-icon">⚠️</div>
                <h3>Could not load reports</h3>
                <p>{error}</p>
              </div>
            )}

            {!loading && !error && displayed.length === 0 && (
              <div className="pr-empty">
                <div className="pr-empty-icon">📋</div>
                <h3>No completed sessions yet</h3>
                <p>Session reports will appear here after your child completes an AI tutoring session.</p>
              </div>
            )}

            {!loading && !error && displayed.map((appt) => {
              const cfg = getSubjectCfg(appt.subject);
              const isOpen = !!expanded[appt.id];
              const isLoadingReport = !!reportLoading[appt.id];
              const report = reportData[appt.id];

              return (
                <div key={appt.id} className="pr-card">
                  <div className="pr-card-top">
                    <div
                      className="pr-subject-icon"
                      style={{ background: cfg.bg }}
                    >
                      {cfg.emoji}
                    </div>

                    <div className="pr-card-info">
                      <div className="pr-card-meta-row">
                        <span
                          className="pr-subject-badge"
                          style={{ background: cfg.bg, color: cfg.color }}
                        >
                          {appt.subject}
                        </span>
                        <span
                          className="pr-subject-badge"
                          style={{ background: "#f0fdf4", color: "#16a34a" }}
                        >
                          ✓ Completed
                        </span>
                      </div>
                      <p className="pr-card-title">{appt.title}</p>
                      <div className="pr-card-details">
                        <span className="pr-detail-item">
                          📅 {formatDate(appt.scheduled_at)}
                        </span>
                        <span className="pr-detail-item">
                          🕐 {formatTime(appt.scheduled_at)}
                        </span>
                        <span className="pr-detail-item">
                          ⏱ {appt.duration_minutes} min
                        </span>
                        {appt.key_stage && (
                          <span className="pr-detail-item">
                            🎓 {appt.key_stage}
                          </span>
                        )}
                        {appt.student_name && (
                          <span className="pr-detail-item">
                            👤 {appt.student_name}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      className={`pr-view-btn${isOpen ? " open" : ""}`}
                      onClick={() => handleToggle(appt.id)}
                    >
                      {isOpen ? "Hide Report ▲" : "View Report ▼"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="pr-report-panel">
                      {isLoadingReport && (
                        <div className="pr-spinner" />
                      )}

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
                        const engCfg = getEngagementCfg(r.engagement_level ?? "");
                        return (
                          <>
                            <div>
                              <p className="pr-report-section-title">Overall Performance</p>
                              <p className="pr-perf-text">{r.overall_performance}</p>
                            </div>

                            <div className="pr-report-row">
                              <div className="pr-report-col">
                                <p className="pr-report-section-title">Strengths</p>
                                <ul className="pr-list">
                                  {(r.strengths ?? []).map((s, i) => (
                                    <li key={i} className="pr-list-item">
                                      <span className="pr-bullet" style={{ background: "#16a34a" }} />
                                      {s}
                                    </li>
                                  ))}
                                  {(!r.strengths || r.strengths.length === 0) && (
                                    <li className="pr-list-item" style={{ color: "#94a3b8" }}>None recorded</li>
                                  )}
                                </ul>
                              </div>

                              <div className="pr-report-col">
                                <p className="pr-report-section-title">Areas for Improvement</p>
                                <ul className="pr-list">
                                  {(r.areas_for_improvement ?? []).map((s, i) => (
                                    <li key={i} className="pr-list-item">
                                      <span className="pr-bullet" style={{ background: "#d97706" }} />
                                      {s}
                                    </li>
                                  ))}
                                  {(!r.areas_for_improvement || r.areas_for_improvement.length === 0) && (
                                    <li className="pr-list-item" style={{ color: "#94a3b8" }}>None recorded</li>
                                  )}
                                </ul>
                              </div>
                            </div>

                            {r.recommendations && (
                              <div>
                                <p className="pr-report-section-title">AI Recommendations</p>
                                <div className="pr-recs-box">
                                  <p className="pr-recs-text">{r.recommendations}</p>
                                </div>
                              </div>
                            )}

                            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
                              {r.engagement_level && (
                                <div>
                                  <p className="pr-report-section-title">Engagement Level</p>
                                  <span
                                    className="pr-engagement-badge"
                                    style={{ background: engCfg.bg, color: engCfg.color }}
                                  >
                                    {engCfg.label}
                                  </span>
                                </div>
                              )}

                              {r.topics_covered && r.topics_covered.length > 0 && (
                                <div style={{ flex: 1 }}>
                                  <p className="pr-report-section-title">Topics Covered</p>
                                  <div className="pr-topics-row">
                                    {r.topics_covered.map((t, i) => (
                                      <span key={i} className="pr-topic-chip">{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
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
