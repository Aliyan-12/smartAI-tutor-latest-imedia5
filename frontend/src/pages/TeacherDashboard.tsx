import { useState, useEffect, useCallback } from "react";
import { Users, MessageSquare, BookOpen, Eye, Activity } from "lucide-react";
import { teacherApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { User, DashboardStats, ChatListItem, Chat } from "../types";

export default function TeacherDashboard() {
  const { logout } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [studentChats, setStudentChats] = useState<ChatListItem[]>([]);
  const [viewingChat, setViewingChat] = useState<Chat | null>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [tab, setTab] = useState<"students" | "activity">("students");
  const [error, setError] = useState("");

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

  const viewStudentChats = async (studentId: number) => {
    try {
      const chats = (await teacherApi.getStudentChats(studentId)) as ChatListItem[];
      setStudentChats(chats);
      setSelectedStudent(studentId);
      setViewingChat(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const viewChat = async (chatId: number) => {
    try {
      const chat = (await teacherApi.viewChat(chatId)) as Chat;
      setViewingChat(chat);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="dashboard-layout">
      <div className="dashboard-header">
        <div className="dashboard-title">
          <BookOpen size={24} />
          <h1>Teacher Dashboard</h1>
        </div>
        <button className="logout-btn-top" onClick={logout}>Sign Out</button>
      </div>

      {error && <div className="dashboard-error">{error}</div>}

      {stats && (
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
      )}

      <div className="tab-bar">
        <button className={tab === "students" ? "tab active" : "tab"} onClick={() => setTab("students")}>
          <Users size={14} /> Students
        </button>
        <button className={tab === "activity" ? "tab active" : "tab"} onClick={() => setTab("activity")}>
          <Activity size={14} /> Recent Activity
        </button>
      </div>

      {tab === "students" && (
        <div className="dashboard-section">
          <div className="teacher-columns">
            <div className="student-list-panel">
              <h3>Students</h3>
              {students.map((s) => (
                <div
                  key={s.id}
                  className={`student-row ${selectedStudent === s.id ? "selected" : ""}`}
                  onClick={() => viewStudentChats(s.id)}
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
                  <h3>Chat History</h3>
                  {studentChats.map((c) => (
                    <div key={c.id} className="chat-row" onClick={() => viewChat(c.id)}>
                      <span>{c.title}</span>
                      <span className="chat-date">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                  {studentChats.length === 0 && <p className="empty-text">No chats yet</p>}
                </>
              ) : (
                <p className="empty-text">Select a student to view their chats</p>
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
      )}

      {tab === "activity" && (
        <div className="dashboard-section">
          <h3>Recent Student Questions</h3>
          <div className="activity-list">
            {recentActivity.map((a: any, i: number) => (
              <div key={i} className="activity-item" onClick={() => viewChat(a.chat_id)}>
                <p className="activity-content">{a.content}</p>
                <span className="activity-time">{new Date(a.timestamp).toLocaleString()}</span>
              </div>
            ))}
            {recentActivity.length === 0 && <p className="empty-text">No recent activity</p>}
          </div>
        </div>
      )}
    </div>
  );
}
