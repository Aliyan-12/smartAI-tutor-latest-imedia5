import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Users, MessageSquare, Eye, Activity, BookOpen } from "lucide-react";
import { teacherApi, assessmentsApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import StudentProgress from "../components/StudentProgress";
import type { User, DashboardStats, ChatListItem, Chat, Assessment } from "../types";

function StatsCards({ stats }: { stats: DashboardStats | null }) {
  if (!stats) return null;
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <Users size={20} />
        <div className="stat-value">{stats.total_students}</div>
        <div className="stat-label">Total Students</div>
      </div>
      <div className="stat-card">
        <Users size={20} />
        <div className="stat-value">{stats.active_students}</div>
        <div className="stat-label">Active Students</div>
      </div>
      <div className="stat-card">
        <MessageSquare size={20} />
        <div className="stat-value">{stats.total_chats}</div>
        <div className="stat-label">Total Chats</div>
      </div>
      <div className="stat-card">
        <MessageSquare size={20} />
        <div className="stat-value">{stats.total_messages}</div>
        <div className="stat-label">Messages</div>
      </div>
    </div>
  );
}

interface AddStudentForm {
  name: string;
  email: string;
  password: string;
  yearGroup: string;
}

interface AddStudentResult {
  id: number;
  name: string;
  email: string;
  invite_code?: string;
}

function StudentsView({
  students,
  error,
  onStudentCreated,
}: {
  students: User[];
  error: string;
  onStudentCreated: () => void;
}) {
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [studentChats, setStudentChats] = useState<ChatListItem[]>([]);
  const [studentAssessments, setStudentAssessments] = useState<Assessment[]>([]);
  const [viewingChat, setViewingChat] = useState<Chat | null>(null);
  const [activeTab, setActiveTab] = useState<"chats" | "progress">("chats");

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddStudentForm>({ name: "", email: "", password: "", yearGroup: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<AddStudentResult | null>(null);

  const [inlineCode, setInlineCode] = useState<{ studentId: number; code: string } | null>(null);
  const [codeLoading, setCodeLoading] = useState<number | null>(null);

  const viewStudentData = async (studentId: number) => {
    try {
      const [chats, assessments] = await Promise.all([
        teacherApi.getStudentChats(studentId) as Promise<ChatListItem[]>,
        assessmentsApi.listForStudent(studentId) as Promise<Assessment[]>,
      ]);
      setStudentChats(chats);
      setStudentAssessments(assessments);
      setSelectedStudent(studentId);
      setViewingChat(null);
      setActiveTab("chats");
    } catch {}
  };

  const viewChat = async (sessionId: string) => {
    try {
      const chat = (await teacherApi.viewChat(sessionId)) as Chat;
      setViewingChat(chat);
    } catch {}
  };

  const openAddModal = () => {
    setAddForm({ name: "", email: "", password: "", yearGroup: "" });
    setAddError(null);
    setAddResult(null);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddResult(null);
    setAddError(null);
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddLoading(true);
    setAddError(null);
    try {
      const result = (await teacherApi.createStudent({
        name: addForm.name.trim(),
        email: addForm.email.trim(),
        password: addForm.password,
        year_group: addForm.yearGroup.trim() || undefined,
      })) as AddStudentResult;
      setAddResult(result);
      onStudentCreated();
    } catch (err: any) {
      setAddError(err.message || "Failed to create student");
    } finally {
      setAddLoading(false);
    }
  };

  const handleGetCode = async (e: React.MouseEvent, studentId: number) => {
    e.stopPropagation();
    setCodeLoading(studentId);
    try {
      const result = (await teacherApi.generateInviteCode(studentId)) as { invite_code: string };
      setInlineCode({ studentId, code: result.invite_code });
    } catch (err: any) {
      alert(err.message || "Failed to generate invite code");
    } finally {
      setCodeLoading(null);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  return (
    <>
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeAddModal(); }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 28,
              maxWidth: 420,
              width: "calc(100% - 48px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            {addResult ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 38, marginBottom: 8 }}>✓</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: "#1a1a2e" }}>
                  Student created!
                </h2>
                <p style={{ fontSize: 14, color: "#555", marginBottom: 4 }}>
                  <strong>{addResult.name}</strong>
                </p>
                <p style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>{addResult.email}</p>
                {addResult.invite_code && (
                  <>
                    <p style={{ fontSize: 13, color: "#555", marginBottom: 8 }}>Invite code:</p>
                    <div
                      onClick={() => copyCode(addResult.invite_code!)}
                      title="Click to copy"
                      style={{
                        display: "inline-block",
                        fontFamily: "monospace",
                        fontSize: 26,
                        fontWeight: 800,
                        letterSpacing: 4,
                        background: "#f0f4ff",
                        border: "2px dashed #4f8ef7",
                        borderRadius: 8,
                        padding: "10px 24px",
                        cursor: "pointer",
                        marginBottom: 12,
                        color: "#1a1a2e",
                        userSelect: "all",
                      }}
                    >
                      {addResult.invite_code}
                    </div>
                    <p style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>
                      Share this code with the parent. They enter it in Parent Dashboard → Link Child.
                    </p>
                  </>
                )}
                <button className="btn-primary" onClick={closeAddModal} style={{ width: "100%" }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 18, color: "#1a1a2e" }}>
                  Add Student
                </h2>
                <form onSubmit={handleAddStudent}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                        Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={addForm.name}
                        onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Jane Smith"
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        value={addForm.email}
                        onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="e.g. jane@school.ac.uk"
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                        Password *
                      </label>
                      <input
                        type="password"
                        required
                        value={addForm.password}
                        onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="Set a temporary password"
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                        Year Group
                      </label>
                      <input
                        type="text"
                        value={addForm.yearGroup}
                        onChange={(e) => setAddForm((f) => ({ ...f, yearGroup: e.target.value }))}
                        placeholder="e.g. Year 9"
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>

                  {addError && (
                    <p style={{ fontSize: 13, color: "var(--danger)", marginTop: 10 }}>{addError}</p>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={closeAddModal}
                      style={{ flex: 1 }}
                      disabled={addLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ flex: 1 }}
                      disabled={addLoading}
                    >
                      {addLoading ? "Creating…" : "Create Student"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

    <div className="dashboard-section">
      <div className="teacher-columns">
        <div className="student-list-panel">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Students</h3>
            <button
              className="btn-primary"
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6 }}
              onClick={openAddModal}
            >
              + Add Student
            </button>
          </div>
          {students.map((s) => (
            <div key={s.id} style={{ display: "flex", flexDirection: "column" }}>
              <div
                className={`student-row ${selectedStudent === s.id ? "selected" : ""}`}
                onClick={() => viewStudentData(s.id)}
              >
                <span className="student-name">{s.name}</span>
                <span className="student-credits">{Number(s.credits).toFixed(0)} cr</span>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, marginRight: 4 }}
                  onClick={(e) => handleGetCode(e, s.id)}
                  disabled={codeLoading === s.id}
                  title="Generate parent invite code"
                >
                  {codeLoading === s.id ? "…" : "Get Code"}
                </button>
                <Eye size={14} />
              </div>
              {inlineCode && inlineCode.studentId === s.id && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    background: "#f0f4ff",
                    border: "1px solid #c7d9fd",
                    borderRadius: 6,
                    marginBottom: 4,
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: 2 }}>
                    {inlineCode.code}
                  </span>
                  <button
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      border: "1px solid #4f8ef7",
                      borderRadius: 4,
                      background: "#fff",
                      color: "#4f8ef7",
                      cursor: "pointer",
                    }}
                    onClick={() => copyCode(inlineCode.code)}
                  >
                    Copy
                  </button>
                  <button
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      border: "none",
                      borderRadius: 4,
                      background: "transparent",
                      color: "#888",
                      cursor: "pointer",
                    }}
                    onClick={() => setInlineCode(null)}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
          {students.length === 0 && <p className="empty-text">No students found</p>}
        </div>

        <div className="chat-list-panel">
          {selectedStudent ? (
            <>
              <div className="tab-bar" style={{ marginBottom: 10 }}>
                <button
                  className={`tab ${activeTab === "chats" ? "active" : ""}`}
                  onClick={() => setActiveTab("chats")}
                >
                  <MessageSquare size={12} />
                  Chat History
                </button>
                <button
                  className={`tab ${activeTab === "progress" ? "active" : ""}`}
                  onClick={() => setActiveTab("progress")}
                >
                  <BookOpen size={12} />
                  Progress
                </button>
              </div>
              {activeTab === "chats" ? (
                <>
                  {studentChats.map((c) => (
                    <div key={c.session_id} className="chat-row" onClick={() => viewChat(c.session_id)}>
                      <span>{c.title}</span>
                      <span className="chat-date">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                  {studentChats.length === 0 && <p className="empty-text">No chats yet</p>}
                </>
              ) : (
                <div style={{ overflowY: "auto", maxHeight: 500 }}>
                  <StudentProgress studentId={selectedStudent} assessments={studentAssessments} />
                </div>
              )}
            </>
          ) : (
            <p className="empty-text">Select a student to view their details</p>
          )}
        </div>

        <div className="chat-view-panel">
          {viewingChat ? (
            <>
              <h3>{viewingChat.title}</h3>
              <div className="chat-messages-view">
                {viewingChat.messages.map((m) => (
                  <div key={m.id} className={`view-message ${m.role}`}>
                    <span className="view-role">{m.role === "user" ? "Student" : "AI"}</span>
                    <p>{m.content}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-text">Select a chat to view messages</p>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function ActivityView({ recentActivity, onViewChat }: { recentActivity: any[]; onViewChat: (sid: string) => void }) {
  return (
    <div className="dashboard-section">
      <h2 style={{ marginBottom: 16 }}>Recent Student Questions</h2>
      <div className="activity-list">
        {recentActivity.map((a: any, i: number) => (
          <div key={i} className="activity-item" onClick={() => onViewChat(a.session_id)}>
            <p className="activity-content">{a.content}</p>
            <span className="activity-time">{new Date(a.timestamp).toLocaleString()}</span>
          </div>
        ))}
        {recentActivity.length === 0 && <p className="empty-text">No recent activity</p>}
      </div>
    </div>
  );
}

export default function TeacherDashboard() {
  const location = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [activityChat, setActivityChat] = useState<Chat | null>(null);

  const currentView = location.pathname === "/teacher/students"
    ? "students"
    : location.pathname === "/teacher/activity"
    ? "activity"
    : "dashboard";

  const loadData = useCallback(async () => {
    try {
      const [dashData, studentData, activityData] = await Promise.all([
        teacherApi.getDashboard() as Promise<DashboardStats>,
        teacherApi.getStudents() as Promise<User[]>,
        teacherApi.getActivity() as Promise<any[]>,
      ]);
      setStats(dashData);
      setStudents(studentData);
      setRecentActivity(activityData);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleViewActivityChat = async (sessionId: string) => {
    try {
      const chat = (await teacherApi.viewChat(sessionId)) as Chat;
      setActivityChat(chat);
    } catch {}
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div className="dashboard-page-header">
            <h1>
              {currentView === "students" ? "Students" : currentView === "activity" ? "Recent Activity" : "Teacher Dashboard"}
            </h1>
          </div>

          {error && <div className="dashboard-error">{error}</div>}

          {currentView === "dashboard" && (
            <>
              <StatsCards stats={stats} />
              <StudentsView students={students} error={error} onStudentCreated={loadData} />
            </>
          )}

          {currentView === "students" && (
            <StudentsView students={students} error={error} onStudentCreated={loadData} />
          )}

          {currentView === "activity" && (
            <>
              <ActivityView recentActivity={recentActivity} onViewChat={handleViewActivityChat} />
              {activityChat && (
                <div className="dashboard-section" style={{ marginTop: 16 }}>
                  <h2 style={{ marginBottom: 16 }}>{activityChat.title}</h2>
                  <div className="chat-messages-view">
                    {activityChat.messages.map((m) => (
                      <div key={m.id} className={`view-message ${m.role}`}>
                        <span className="view-role">{m.role === "user" ? "Student" : "AI"}</span>
                        <p>{m.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
