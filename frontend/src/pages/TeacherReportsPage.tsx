import { useState, useEffect } from "react";
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
};

function getSubjectConfig(subject: string) {
  const key = subject?.toLowerCase() ?? "";
  return SUBJECT_CONFIG[key] ?? { emoji: "📚", color: "#64748b", bg: "#f8fafc" };
}

function getEngagementStyle(level: string): { label: string; color: string; bg: string } {
  switch (level?.toLowerCase()) {
    case "excellent": return { label: "Excellent", color: "#15803d", bg: "#f0fdf4" };
    case "good":      return { label: "Good",      color: "#1d4ed8", bg: "#eff6ff" };
    case "fair":      return { label: "Needs Support", color: "#d97706", bg: "#fffbeb" };
    case "poor":      return { label: "Struggling", color: "#dc2626", bg: "#fef2f2" };
    default:          return { label: level ?? "—", color: "#64748b", bg: "#f8fafc" };
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function TeacherReportsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [reports, setReports] = useState<Record<number, ReportData | null>>({});
  const [reportLoading, setReportLoading] = useState<Record<number, boolean>>({});
  const [filterStudent, setFilterStudent] = useState<string>("all");

  useEffect(() => {
    appointmentsApi
      .list("completed")
      .then((data) => setAppointments((data as Appointment[]) ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const studentNames = Array.from(
    new Set(appointments.map((a) => a.student_name ?? `Student #${a.student_id}`))
  );

  const displayed = filterStudent === "all"
    ? appointments
    : appointments.filter((a) => (a.student_name ?? `Student #${a.student_id}`) === filterStudent);

  const completedThisWeek = appointments.filter((a) => {
    const t = new Date(a.scheduled_at).getTime();
    return Date.now() - t < 7 * 24 * 3600 * 1000;
  }).length;

  const toggleExpand = async (appt: Appointment) => {
    const id = appt.id;
    const nowExpanded = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: nowExpanded }));
    if (nowExpanded && reports[id] === undefined) {
      setReportLoading((prev) => ({ ...prev, [id]: true }));
      try {
        const data = await appointmentsApi.getReport(id) as ReportData;
        setReports((prev) => ({ ...prev, [id]: data }));
      } catch {
        setReports((prev) => ({ ...prev, [id]: null }));
      } finally {
        setReportLoading((prev) => ({ ...prev, [id]: false }));
      }
    }
  };

  return (
    <>
      <style>{`
        .tr-page  { display: flex; height: 100vh; background: #f5f5f0; }
        .tr-main  { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .tr-inner { padding: 32px 40px; flex: 1; }

        .tr-header { margin-bottom: 24px; }
        .tr-header h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
        .tr-header p  { font-size: 14px; color: #64748b; margin: 0; }

        .tr-stats {
          display: grid; grid-template-columns: repeat(3,1fr);
          gap: 12px; margin-bottom: 24px;
        }
        .tr-stat {
          background: white; border: 1px solid #e2e8f0;
          border-radius: 10px; padding: 16px 18px;
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }
        .tr-stat-val { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 3px; }
        .tr-stat-lbl { font-size: 12px; color: #64748b; }

        .tr-filters {
          display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;
        }
        .tr-chip {
          padding: 6px 14px; border-radius: 999px;
          font-size: 13px; font-weight: 600;
          border: 1.5px solid #e2e8f0;
          background: white; color: #475569;
          cursor: pointer; transition: all .15s;
        }
        .tr-chip:hover, .tr-chip.active {
          background: #1a73e8; color: white; border-color: #1a73e8;
        }

        .tr-list { display: flex; flex-direction: column; gap: 12px; }

        .tr-card {
          background: white; border: 1.5px solid #e2e8f0;
          border-radius: 12px; overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
          transition: box-shadow .15s;
        }
        .tr-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); }

        .tr-card-top {
          padding: 18px 20px;
          display: flex; align-items: flex-start; gap: 14px;
        }
        .tr-subj-icon {
          width: 44px; height: 44px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; flex-shrink: 0;
        }
        .tr-card-body { flex: 1; min-width: 0; }
        .tr-card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
        .tr-student-chip {
          font-size: 11px; font-weight: 700; color: #1a73e8;
          background: #eff6ff; padding: 2px 8px; border-radius: 999px;
        }
        .tr-subj-badge {
          font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
        }
        .tr-card-title { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
        .tr-card-date  { font-size: 12px; color: #64748b; }

        .tr-card-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .tr-eng-badge {
          font-size: 11px; font-weight: 700;
          padding: 4px 10px; border-radius: 999px;
        }
        .tr-view-btn {
          padding: 8px 16px; border-radius: 8px;
          background: #1a73e8; color: white;
          border: none; font-size: 13px; font-weight: 700;
          cursor: pointer; white-space: nowrap;
          transition: background .15s; font-family: inherit;
        }
        .tr-view-btn:hover { background: #1557b0; }
        .tr-view-btn.open  { background: #f1f5f9; color: #64748b; }

        .tr-report {
          border-top: 1px solid #f1f5f9;
          padding: 20px;
          background: #fafafa;
        }
        .tr-report-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;
        }
        .tr-report-section h4 {
          font-size: 12px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .4px; color: #64748b; margin: 0 0 8px;
        }
        .tr-report-section p {
          font-size: 13px; color: #475569; line-height: 1.55; margin: 0;
        }
        .tr-bullet-list { margin: 0; padding: 0; list-style: none; }
        .tr-bullet-list li {
          font-size: 13px; color: #475569; margin-bottom: 5px;
          padding-left: 14px; position: relative; line-height: 1.4;
        }
        .tr-bullet-list li::before { content: "•"; position: absolute; left: 0; }
        .tr-bullet-list.green li::before { color: #16a34a; }
        .tr-bullet-list.amber li::before { color: #d97706; }
        .tr-rec-box {
          padding: 12px 14px; background: #eff6ff;
          border-radius: 8px; border-left: 3px solid #1a73e8; margin-bottom: 14px;
        }
        .tr-rec-box h4 { font-size: 12px; font-weight: 700; color: #1e40af; margin: 0 0 5px; }
        .tr-rec-box p  { font-size: 13px; color: #1e3a8a; margin: 0; line-height: 1.5; }
        .tr-topics { display: flex; flex-wrap: wrap; gap: 6px; }
        .tr-topic  {
          font-size: 11px; font-weight: 600; color: #374151;
          background: #f1f5f9; border: 1px solid #e2e8f0;
          border-radius: 999px; padding: 3px 10px;
        }
        .tr-spinner {
          width: 28px; height: 28px; border: 3px solid #e2e8f0;
          border-top-color: #1a73e8; border-radius: 50%;
          animation: tr-spin .8s linear infinite; margin: 16px auto;
        }
        @keyframes tr-spin { to { transform: rotate(360deg); } }

        .tr-empty {
          text-align: center; padding: 80px 24px;
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .tr-empty-icon { font-size: 48px; }
        .tr-empty h3   { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
        .tr-empty p    { font-size: 14px; color: #64748b; margin: 0; max-width: 360px; }
      `}</style>

      <div className="tr-page">
        <Sidebar />
        <div className="tr-main">
          <div className="tr-inner">
            <div className="tr-header">
              <h1>Session Reports</h1>
              <p>AI-generated summaries for completed student sessions.</p>
            </div>

            {/* Stats */}
            <div className="tr-stats">
              <div className="tr-stat">
                <div className="tr-stat-val">{appointments.length}</div>
                <div className="tr-stat-lbl">Total Completed Sessions</div>
              </div>
              <div className="tr-stat">
                <div className="tr-stat-val">{completedThisWeek}</div>
                <div className="tr-stat-lbl">Sessions This Week</div>
              </div>
              <div className="tr-stat">
                <div className="tr-stat-val">{studentNames.length}</div>
                <div className="tr-stat-lbl">Students With Reports</div>
              </div>
            </div>

            {/* Filters */}
            {studentNames.length > 0 && (
              <div className="tr-filters">
                <button
                  className={`tr-chip${filterStudent === "all" ? " active" : ""}`}
                  onClick={() => setFilterStudent("all")}
                >
                  All Students
                </button>
                {studentNames.map((name) => (
                  <button
                    key={name}
                    className={`tr-chip${filterStudent === name ? " active" : ""}`}
                    onClick={() => setFilterStudent(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="tr-empty">
                <div className="tr-spinner" />
                <p>Loading session reports…</p>
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <div className="tr-empty">
                <div className="tr-empty-icon">⚠️</div>
                <h3>Couldn't load reports</h3>
                <p>{error}</p>
              </div>
            )}

            {/* Empty */}
            {!loading && !error && displayed.length === 0 && (
              <div className="tr-empty">
                <div className="tr-empty-icon">📋</div>
                <h3>No completed sessions yet</h3>
                <p>Session reports will appear here once students complete their AI tutoring sessions.</p>
              </div>
            )}

            {/* Cards */}
            {!loading && !error && displayed.length > 0 && (
              <div className="tr-list">
                {displayed.map((appt) => {
                  const cfg = getSubjectConfig(appt.subject);
                  const isOpen = !!expanded[appt.id];
                  const report = reports[appt.id];
                  const loadingReport = !!reportLoading[appt.id];
                  const studentLabel = appt.student_name ?? `Student #${appt.student_id}`;
                  const engStyle = report?.report?.engagement_level
                    ? getEngagementStyle(report.report.engagement_level)
                    : null;

                  return (
                    <div key={appt.id} className="tr-card">
                      <div className="tr-card-top">
                        <div className="tr-subj-icon" style={{ background: cfg.bg }}>
                          {cfg.emoji}
                        </div>
                        <div className="tr-card-body">
                          <div className="tr-card-meta">
                            <span className="tr-student-chip">{studentLabel}</span>
                            <span
                              className="tr-subj-badge"
                              style={{ background: cfg.bg, color: cfg.color }}
                            >
                              {appt.subject}
                            </span>
                            {engStyle && (
                              <span
                                className="tr-eng-badge"
                                style={{ background: engStyle.bg, color: engStyle.color }}
                              >
                                {engStyle.label}
                              </span>
                            )}
                          </div>
                          <div className="tr-card-title">{appt.title}</div>
                          <div className="tr-card-date">{formatDate(appt.scheduled_at)}</div>
                        </div>
                        <div className="tr-card-right">
                          <button
                            className={`tr-view-btn${isOpen ? " open" : ""}`}
                            onClick={() => toggleExpand(appt)}
                          >
                            {isOpen ? "Hide Report" : "View Report →"}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="tr-report">
                          {loadingReport && <div className="tr-spinner" />}

                          {!loadingReport && report === null && (
                            <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", margin: 0 }}>
                              Report not yet generated for this session.
                            </p>
                          )}

                          {!loadingReport && report?.report && (() => {
                            const r = report.report;
                            return (
                              <>
                                {r.overall_performance && (
                                  <div style={{ marginBottom: 16 }}>
                                    <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#64748b", margin: "0 0 8px" }}>
                                      Overall Performance
                                    </h4>
                                    <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.55, margin: 0 }}>
                                      {r.overall_performance}
                                    </p>
                                  </div>
                                )}

                                <div className="tr-report-grid">
                                  {r.strengths?.length > 0 && (
                                    <div className="tr-report-section">
                                      <h4>✅ Strengths</h4>
                                      <ul className="tr-bullet-list green">
                                        {r.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {r.areas_for_improvement?.length > 0 && (
                                    <div className="tr-report-section">
                                      <h4>⚠️ Areas for Improvement</h4>
                                      <ul className="tr-bullet-list amber">
                                        {r.areas_for_improvement.map((s, i) => <li key={i}>{s}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                </div>

                                {r.recommendations && (
                                  <div className="tr-rec-box">
                                    <h4>🤖 AI Recommendations for Teacher</h4>
                                    <p>{r.recommendations}</p>
                                  </div>
                                )}

                                {r.topics_covered?.length > 0 && (
                                  <div>
                                    <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#64748b", margin: "0 0 8px" }}>
                                      Topics Covered
                                    </h4>
                                    <div className="tr-topics">
                                      {r.topics_covered.map((t, i) => (
                                        <span key={i} className="tr-topic">{t}</span>
                                      ))}
                                    </div>
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
            )}
          </div>
        </div>
      </div>
    </>
  );
}
