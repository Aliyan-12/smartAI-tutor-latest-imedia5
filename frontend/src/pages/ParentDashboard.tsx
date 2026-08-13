import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Users, BookOpen, MessageSquare, Link, Eye, ChevronRight, ChevronLeft } from "lucide-react";
import { parentApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import StudentProgress from "../components/StudentProgress";
import type { User, Assessment, ChatListItem, Chat } from "../types";

interface ParentDashboardData {
  linked_students: number;
  total_assessments: number;
  total_chats: number;
  recent_activity?: unknown[];
}

// ── Dashboard overview ───────────────────────────────────────────────────────
function DashboardView({ data }: { data: ParentDashboardData | null }) {
  if (!data) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center" }}>
        <div className="typing-indicator" style={{ justifyContent: "center" }}>
          <span /><span /><span />
        </div>
      </div>
    );
  }
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <Users size={20} />
        <div className="stat-value">{data.linked_students}</div>
        <div className="stat-label">Linked Children</div>
      </div>
      <div className="stat-card">
        <BookOpen size={20} />
        <div className="stat-value">{data.total_assessments}</div>
        <div className="stat-label">Total Assessments</div>
      </div>
      <div className="stat-card">
        <MessageSquare size={20} />
        <div className="stat-value">{data.total_chats}</div>
        <div className="stat-label">Total Chats</div>
      </div>
    </div>
  );
}

// ── Student detail panel ─────────────────────────────────────────────────────
interface StudentDetailProps {
  student: User;
  onBack: () => void;
}

function StudentDetail({ student, onBack }: StudentDetailProps) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [viewingChat, setViewingChat] = useState<Chat | null>(null);
  const [activeTab, setActiveTab] = useState<"progress" | "chats">("progress");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [assessData, chatData] = await Promise.all([
          parentApi.getStudentAssessments(student.id) as Promise<Assessment[]>,
          parentApi.getStudentChats(student.id) as Promise<ChatListItem[]>,
        ]);
        setAssessments(assessData);
        setChats(chatData);
      } catch (err: any) {
        setError(err.message || "Failed to load student data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [student.id]);

  const viewChat = async (sessionId: string) => {
    // Use the chats list to load the full chat.
    // We rely on the parent chat endpoint; fall back to a simple display.
    try {
      // parentApi doesn't expose a viewChat, but getStudentChats returns ChatListItem.
      // We show a simple "chat selected" indicator here.
      const found = chats.find((c) => c.session_id === sessionId);
      if (found) {
        setViewingChat({ id: 0, session_id: found.session_id, title: found.title, created_at: found.created_at, messages: [] });
      }
    } catch {}
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <button
          className="btn-secondary"
          style={{ display: "flex", alignItems: "center", gap: 5 }}
          onClick={onBack}
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{student.name}</h2>
        <span className="role-tag role-student" style={{ marginLeft: 4 }}>
          {student.email}
        </span>
      </div>

      <div className="tab-bar" style={{ marginBottom: 18 }}>
        <button
          className={`tab ${activeTab === "progress" ? "active" : ""}`}
          onClick={() => setActiveTab("progress")}
        >
          <BookOpen size={13} />
          Progress &amp; Assessments
        </button>
        <button
          className={`tab ${activeTab === "chats" ? "active" : ""}`}
          onClick={() => setActiveTab("chats")}
        >
          <MessageSquare size={13} />
          Chat History
        </button>
      </div>

      {error && <div className="dashboard-error">{error}</div>}

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div className="typing-indicator" style={{ justifyContent: "center" }}>
            <span /><span /><span />
          </div>
        </div>
      ) : activeTab === "progress" ? (
        <StudentProgress studentId={student.id} assessments={assessments} />
      ) : (
        <div>
          {viewingChat ? (
            <div className="dashboard-section">
              <div className="section-header">
                <h2>{viewingChat.title}</h2>
                <button
                  className="btn-secondary"
                  onClick={() => setViewingChat(null)}
                  style={{ display: "flex", alignItems: "center", gap: 5 }}
                >
                  <ChevronLeft size={14} />
                  All Chats
                </button>
              </div>
              {viewingChat.messages.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Chat preview is not available for this session.
                </p>
              ) : (
                <div className="chat-messages-view">
                  {viewingChat.messages.map((m) => (
                    <div key={m.id} className={`view-message ${m.role}`}>
                      <span className="view-role">{m.role === "user" ? "Student" : "AI"}</span>
                      <p>{m.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="dashboard-section">
              <div className="section-header">
                <h2>Chat Sessions</h2>
              </div>
              {chats.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No chat sessions yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {chats.map((c) => (
                    <div
                      key={c.session_id}
                      className="chat-row"
                      onClick={() => viewChat(c.session_id)}
                    >
                      <span style={{ flex: 1, fontWeight: 500 }}>{c.title}</span>
                      {c.last_message && (
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--text-muted)",
                            maxWidth: 260,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.last_message}
                        </span>
                      )}
                      <span className="chat-date">
                        {new Date(c.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <Eye size={13} style={{ color: "var(--text-muted)" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Students list view ────────────────────────────────────────────────────────
function StudentsView({
  students,
  onSelectStudent,
  onLinked,
}: {
  students: User[];
  onSelectStudent: (s: User) => void;
  onLinked: () => void;
}) {
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [linkSuccess, setLinkSuccess] = useState("");

  const openLinkModal = () => {
    setLinkCode("");
    setLinkError("");
    setLinkSuccess("");
    setShowLinkModal(true);
  };

  const closeLinkModal = () => {
    setShowLinkModal(false);
    setLinkSuccess("");
    setLinkError("");
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkCode.trim()) return;
    setLinkLoading(true);
    setLinkError("");
    setLinkSuccess("");
    try {
      const result = (await parentApi.linkStudent(linkCode.trim())) as { student?: { name: string } };
      const studentName = result?.student?.name || "Student";
      setLinkSuccess(`${studentName} has been linked to your account!`);
      onLinked();
    } catch (err: any) {
      setLinkError(err.message || "Invalid invite code. Please check and try again.");
    } finally {
      setLinkLoading(false);
    }
  };

  return (
    <>
      {showLinkModal && (
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
          onClick={(e) => { if (e.target === e.currentTarget) closeLinkModal(); }}
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
            {linkSuccess ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 38, marginBottom: 8 }}>✓</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "#1a1a2e" }}>
                  Child linked!
                </h2>
                <p style={{ fontSize: 14, color: "#555", marginBottom: 20 }}>{linkSuccess}</p>
                <button className="btn-primary" onClick={closeLinkModal} style={{ width: "100%" }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, color: "#1a1a2e" }}>
                  Link a Child
                </h2>
                <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
                  Enter the invite code provided by your child's teacher to link their account.
                </p>
                <form onSubmit={handleLink}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                      Invite Code
                    </label>
                    <input
                      type="text"
                      required
                      value={linkCode}
                      onChange={(e) => setLinkCode(e.target.value)}
                      placeholder="e.g. ABC123"
                      style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 15 }}
                    />
                  </div>
                  {linkError && (
                    <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 8 }}>{linkError}</p>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={closeLinkModal}
                      style={{ flex: 1 }}
                      disabled={linkLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ flex: 1 }}
                      disabled={linkLoading || !linkCode.trim()}
                    >
                      {linkLoading ? "Linking…" : "Link Student"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <div className="section-header">
          <h2>Your Children</h2>
          <button
            className="btn-primary"
            style={{ fontSize: 13, padding: "6px 14px", borderRadius: 6 }}
            onClick={openLinkModal}
          >
            + Link Child
          </button>
        </div>
        {students.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            No children linked yet. Click "Link Child" above to add a student using an invite code.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {students.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
                onClick={() => onSelectStudent(s)}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--accent-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    color: "var(--accent)",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{s.name}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.email}</p>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: s.is_active ? "var(--success)" : "var(--text-muted)",
                    fontWeight: 600,
                    marginRight: 6,
                  }}
                >
                  {s.is_active ? "Active" : "Inactive"}
                </span>
                <ChevronRight size={15} style={{ color: "var(--text-muted)" }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Link invite code section ─────────────────────────────────────────────────
function InviteCodeSection({ onLinked }: { onLinked: () => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await parentApi.linkWithCode(code.trim());
      setSuccess("Student account linked successfully!");
      setCode("");
      onLinked();
    } catch (err: any) {
      setError(err.message || "Failed to link student. Please check the invite code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-section">
      <div className="section-header">
        <h2>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Link size={15} />
            Link a Student Account
          </span>
        </h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
        Enter the invite code provided by your child's teacher or school to link their account to your parent dashboard.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <input
            type="text"
            placeholder="Enter invite code (e.g. ABC123)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !code.trim()}
          >
            {loading ? "Linking…" : "Link Student"}
          </button>
        </div>
        {error && <p style={{ fontSize: 13, color: "var(--danger)", marginTop: 6 }}>{error}</p>}
        {success && (
          <p style={{ fontSize: 13, color: "var(--success)", marginTop: 6, fontWeight: 600 }}>
            {success}
          </p>
        )}
      </form>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ParentDashboard() {
  const location = useLocation();
  const [dashboardData, setDashboardData] = useState<ParentDashboardData | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
  const [error, setError] = useState("");

  const currentView = location.pathname === "/parent/students"
    ? "students"
    : location.pathname === "/parent/appointments"
    ? "appointments"
    : "dashboard";

  const loadStudents = useCallback(async () => {
    try {
      const data = (await parentApi.getStudents()) as User[];
      setStudents(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [dash, studentList] = await Promise.all([
        parentApi.getDashboard() as Promise<ParentDashboardData>,
        parentApi.getStudents() as Promise<User[]>,
      ]);
      setDashboardData(dash);
      setStudents(studentList);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset selected student when changing views
  useEffect(() => {
    setSelectedStudent(null);
  }, [currentView]);

  const pageTitle =
    currentView === "students" ? "My Children"
    : currentView === "appointments" ? "Appointments"
    : "Parent Dashboard";

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div className="dashboard-page-header">
            <h1>{pageTitle}</h1>
          </div>

          {error && <div className="dashboard-error">{error}</div>}

          {currentView === "dashboard" && (
            <>
              <DashboardView data={dashboardData} />
              <StudentsView
                students={students}
                onSelectStudent={(s) => setSelectedStudent(s)}
                onLinked={loadData}
              />
              {selectedStudent && (
                <StudentDetail
                  student={selectedStudent}
                  onBack={() => setSelectedStudent(null)}
                />
              )}
            </>
          )}

          {currentView === "students" && (
            <>
              {selectedStudent ? (
                <StudentDetail
                  student={selectedStudent}
                  onBack={() => setSelectedStudent(null)}
                />
              ) : (
                <StudentsView
                  students={students}
                  onSelectStudent={setSelectedStudent}
                  onLinked={loadStudents}
                />
              )}
            </>
          )}

          {currentView === "appointments" && (
            <div className="dashboard-section">
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Use the Appointments page to view and book sessions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
