import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, BookOpen, MessageCircle } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { SkeletonList } from "../components/ui";
import { assignmentsApi } from "../services/api";
import type { MyAssignment } from "../types";

const TYPE_CONFIG: Record<string, { label: string; bg: string; color: string; cta: string }> = {
  homework: { label: "HOMEWORK", bg: "#fff7ed", color: "#ea580c", cta: "Start Homework" },
  reading:  { label: "READING",  bg: "#f0fdf4", color: "#16a34a", cta: "Start Catch Up" },
  prep:     { label: "PREP",     bg: "#fef2f2", color: "#dc2626", cta: "Start Revision" },
  revision: { label: "REVISION", bg: "#eff6ff", color: "#2563eb", cta: "Start Revision" },
};

const SUBJECT_STYLES: Record<string, { color: string; bg: string; icon: string }> = {
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

function getSubjectStyle(subject: string) {
  return SUBJECT_STYLES[subject.toLowerCase()] ?? { color: "#64748b", bg: "#f8fafc", icon: "📖" };
}

function formatDue(dateStr: string | null): { text: string; urgent: boolean } {
  if (!dateStr) return { text: "No due date", urgent: false };
  const due = new Date(dateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const timeStr = due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (diffMs < 0) return { text: "Overdue", urgent: true };
  if (diffDays === 0) return { text: `Today, ${timeStr}`, urgent: true };
  if (diffDays === 1) return { text: `Tomorrow, ${timeStr}`, urgent: true };
  if (diffDays < 7) {
    const day = due.toLocaleDateString("en-GB", { weekday: "long" });
    return { text: `${day}, ${timeStr}`, urgent: false };
  }
  return {
    text: due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    urgent: false,
  };
}

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"todo" | "completed" | "all">("todo");
  const [calendarToast, setCalendarToast] = useState(false);

  useEffect(() => {
    assignmentsApi
      .getMy()
      .then((data) => setAssignments(data as MyAssignment[]))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const todo = assignments.filter((a) => a.status === "assigned" || a.status === "started");
  const completed = assignments.filter((a) => a.status === "completed");

  const displayed =
    activeTab === "todo" ? todo : activeTab === "completed" ? completed : assignments;

  const handleStart = async (a: MyAssignment) => {
    if (a.status === "assigned") {
      await assignmentsApi.startAssignment(a.homework_id).catch(() => {});
    }
    // If the assignment has a linked session/appointment, go directly to that session
    if ((a as any).session_id) {
      navigate(`/session/${(a as any).session_id}`);
      return;
    }
    if ((a as any).appointment_id) {
      navigate(`/session/${(a as any).appointment_id}`);
      return;
    }
    // Otherwise open lesson setup in teacher_homework mode
    navigate("/lesson/setup", {
      state: {
        mode: "teacher_homework",
        assignment: a,
        subject: a.homework?.subject,
      },
    });
  };

  const handleAskAI = () => navigate("/chat");

  return (
    <>
      <style>{`
        .asgn-page { display: flex; height: 100vh; background: #f8fafc; }
        .asgn-main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .asgn-header { padding: 0; }
        .asgn-header-row { display: flex; align-items: flex-start; justify-content: space-between; }
        .asgn-title { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
        .asgn-subtitle { font-size: 14px; color: #64748b; margin: 0; }
        .asgn-hero {
          margin: 24px 24px 0;
          background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
          border-radius: 16px;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
        }
        .asgn-hero-deco1 {
          position: absolute; top: -20px; right: 80px;
          width: 90px; height: 90px; border-radius: 50%;
          background: rgba(255,255,255,0.08); pointer-events: none;
        }
        .asgn-hero-deco2 {
          position: absolute; bottom: -25px; right: 20px;
          width: 110px; height: 110px; border-radius: 50%;
          background: rgba(255,255,255,0.06); pointer-events: none;
        }
        .asgn-cal-btn {
          display: flex; align-items: center; gap: 6px; padding: 8px 16px;
          background: white; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 13px; font-weight: 600; color: #374151; cursor: pointer;
          transition: border-color .15s;
        }
        .asgn-cal-btn:hover { border-color: #3b82f6; color: #3b82f6; }
        .asgn-tabs { display: flex; gap: 0; padding: 24px 40px 0; border-bottom: 2px solid #e2e8f0; overflow-x: auto; -webkit-overflow-scrolling: touch; flex-shrink: 0; scrollbar-width: none; }
        .asgn-tabs::-webkit-scrollbar { display: none; }
        .asgn-tab {
          padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer;
          color: #64748b; border-bottom: 2px solid transparent; margin-bottom: -2px;
          transition: color .15s, border-color .15s; background: none; border-top: none;
          border-left: none; border-right: none; white-space: nowrap; flex-shrink: 0;
        }
        .asgn-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }
        .asgn-tab:hover:not(.active) { color: #374151; }
        .asgn-body { flex: 1; padding: 24px 40px; display: flex; flex-direction: column; gap: 14px; }
        @media (max-width: 640px) {
          .asgn-tabs { padding: 12px 16px 0; }
          .asgn-body { padding: 16px; }
        }
        .asgn-card {
          background: white; border-radius: 12px; border: 1.5px solid #e2e8f0;
          padding: 20px 24px; display: flex; align-items: flex-start;
          gap: 18px; transition: box-shadow .15s, transform .15s;
          border-left: 4px solid #e2e8f0;
        }
        .asgn-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.1); transform: translateY(-2px); }
        .asgn-subject-bubble {
          width: 44px; height: 44px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; flex-shrink: 0;
        }
        .asgn-type-badge {
          padding: 3px 10px; border-radius: 999px; font-size: 11px;
          font-weight: 700; letter-spacing: .4px; white-space: nowrap;
        }
        .asgn-card-content { flex: 1; min-width: 0; }
        .asgn-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
        .asgn-card-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
        .asgn-card-desc { font-size: 13px; color: #475569; margin: 0 0 12px; line-height: 1.5; }
        .asgn-card-meta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .asgn-meta-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #64748b; }
        .asgn-meta-item.urgent { color: #dc2626; font-weight: 600; }
        .asgn-cta-btn {
          padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 700;
          background: #3b82f6; color: white; border: none; cursor: pointer;
          white-space: nowrap; transition: background .15s; align-self: center;
        }
        .asgn-cta-btn:hover { background: #2563eb; }
        .asgn-cta-btn.done { background: #e2e8f0; color: #94a3b8; cursor: default; }
        .asgn-empty {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 10px; padding: 60px 20px; text-align: center;
          color: #64748b;
        }
        .asgn-empty-icon { font-size: 48px; }
        .asgn-empty h3 { margin: 0; font-size: 18px; font-weight: 700; color: #0f172a; }
        .asgn-empty p { margin: 0; font-size: 14px; }
        .asgn-footer {
          margin: 0 40px 24px; background: white; border: 1.5px solid #e2e8f0;
          border-radius: 12px; padding: 16px 24px; display: flex;
          align-items: center; justify-content: space-between; gap: 16px;
        }
        .asgn-footer-left { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #475569; }
        .asgn-footer-ask {
          padding: 8px 16px; border-radius: 8px; background: #f0f9ff;
          color: #0284c7; border: 1.5px solid #bae6fd; font-size: 13px;
          font-weight: 600; cursor: pointer; transition: background .15s;
        }
        .asgn-footer-ask:hover { background: #e0f2fe; }
        .asgn-toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: #1e293b; color: white; padding: 10px 20px; border-radius: 8px;
          font-size: 13px; font-weight: 600; z-index: 9999; animation: fadeIn .2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>

      <div className="asgn-page">
        <Sidebar />
        <div className="asgn-main">
          <div className="asgn-header">
            <div className="asgn-hero">
              <div className="asgn-hero-deco1" /><div className="asgn-hero-deco2" />
              <div style={{ zIndex: 1 }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "0 0 4px" }}>📝 Assignments</h1>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0 }}>
                  Your homework and learning tasks from your teachers.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, zIndex: 1 }}>
                <button
                  className="asgn-cal-btn"
                  style={{ background: "rgba(255,255,255,0.95)", borderColor: "transparent" }}
                  onClick={() => { setCalendarToast(true); setTimeout(() => setCalendarToast(false), 2500); }}
                >
                  <Calendar size={15} /> Calendar
                </button>
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
                  zIndex: 0,
                }}
              />
            </div>
          </div>

          <div className="asgn-tabs">
            <button className={`asgn-tab${activeTab === "todo" ? " active" : ""}`} onClick={() => setActiveTab("todo")}>
              To Do {todo.length > 0 && `(${todo.length})`}
            </button>
            <button className={`asgn-tab${activeTab === "completed" ? " active" : ""}`} onClick={() => setActiveTab("completed")}>
              Completed {completed.length > 0 && `(${completed.length})`}
            </button>
            <button className={`asgn-tab${activeTab === "all" ? " active" : ""}`} onClick={() => setActiveTab("all")}>
              All Assignments
            </button>
          </div>

          <div className="asgn-body">
            {loading && <div style={{ padding: 16 }}><SkeletonList rows={5} /></div>}

            {!loading && error && (
              <div className="asgn-empty">
                <div className="asgn-empty-icon">⚠️</div>
                <h3>Couldn't load assignments</h3>
                <p>{error}</p>
              </div>
            )}

            {!loading && !error && displayed.length === 0 && (
              <div className="asgn-empty">
                <div className="asgn-empty-icon">{activeTab === "completed" ? "🏆" : "🎉"}</div>
                <h3>{activeTab === "completed" ? "No completed assignments yet" : "You're all caught up!"}</h3>
                <p>{activeTab === "completed" ? "Complete an assignment to see it here." : "No assignments due right now. Great job!"}</p>
              </div>
            )}

            {!loading && !error && displayed.map((a) => {
              const hw = a.homework;
              const cfg = TYPE_CONFIG[hw.assignment_type] ?? TYPE_CONFIG.homework;
              const ss = getSubjectStyle(hw.subject);
              const due = formatDue(hw.due_date);
              const isDone = a.status === "completed";

              return (
                <div
                  key={a.id}
                  className="asgn-card"
                  style={{ borderLeftColor: isDone ? "#e2e8f0" : ss.color }}
                >
                  {/* Subject icon bubble */}
                  <div
                    className="asgn-subject-bubble"
                    style={{ background: ss.bg, border: `1.5px solid ${ss.color}33` }}
                  >
                    {ss.icon}
                  </div>
                  <div className="asgn-card-content">
                    <div className="asgn-card-top">
                      <span
                        className="asgn-type-badge"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                      {/* Subject chip */}
                      <span
                        className="asgn-type-badge"
                        style={{ background: ss.bg, color: ss.color }}
                      >
                        {hw.subject}
                      </span>
                      {isDone && (
                        <span className="asgn-type-badge" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                          ✓ COMPLETED
                        </span>
                      )}
                    </div>
                    <p className="asgn-card-title">{hw.title}</p>
                    {hw.instructions && (
                      <p className="asgn-card-desc">{hw.instructions}</p>
                    )}
                    <div className="asgn-card-meta">
                      <span className={`asgn-meta-item${due.urgent ? " urgent" : ""}`}>
                        <Calendar size={13} /> Due: {due.text}
                      </span>
                      <span className="asgn-meta-item">
                        <Clock size={13} /> Est. {hw.estimated_minutes < 60
                          ? `${hw.estimated_minutes} min`
                          : `${Math.round(hw.estimated_minutes / 60)} hr`}
                      </span>
                    </div>
                  </div>
                  <button
                    className={`asgn-cta-btn${isDone ? " done" : ""}`}
                    style={isDone ? {} : { background: ss.color }}
                    onClick={() => !isDone && handleStart(a)}
                    disabled={isDone}
                  >
                    {isDone ? "Done ✓" : cfg.cta + " →"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="asgn-footer">
            <div className="asgn-footer-left">
              <MessageCircle size={16} color="#0284c7" />
              <span>Need help? Ask your AI Tutor anything about your assignments.</span>
            </div>
            <button className="asgn-footer-ask" onClick={handleAskAI}>
              Ask AI Tutor →
            </button>
          </div>

          <p style={{ textAlign: "center", fontSize: 13, color: "#94a3b8", padding: "0 40px 24px" }}>
            That's all for now! Great job staying on top of your learning 🎉
          </p>
        </div>
      </div>

      {calendarToast && (
        <div className="asgn-toast">📅 Calendar view coming soon!</div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
