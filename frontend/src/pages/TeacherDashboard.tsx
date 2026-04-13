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

function StudentsView({ students, error }: { students: User[]; error: string }) {
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [studentChats, setStudentChats] = useState<ChatListItem[]>([]);
  const [studentAssessments, setStudentAssessments] = useState<Assessment[]>([]);
  const [viewingChat, setViewingChat] = useState<Chat | null>(null);
  const [activeTab, setActiveTab] = useState<"chats" | "progress">("chats");

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

  return (
    <div className="dashboard-section">
      <div className="teacher-columns">
        <div className="student-list-panel">
          <h3>Students</h3>
          {students.map((s) => (
            <div
              key={s.id}
              className={`student-row ${selectedStudent === s.id ? "selected" : ""}`}
              onClick={() => viewStudentData(s.id)}
            >
              <span className="student-name">{s.name}</span>
              <span className="student-credits">{Number(s.credits).toFixed(0)} cr</span>
              <Eye size={14} />
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
              <StudentsView students={students} error={error} />
            </>
          )}

          {currentView === "students" && (
            <StudentsView students={students} error={error} />
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
