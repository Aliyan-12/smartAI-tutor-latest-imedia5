import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  MessageSquarePlus, Trash2, LogOut, Coins,
  LayoutDashboard, Users, Activity, Shield,
  BookOpen, Settings, Calendar, ChevronDown, ChevronRight,
  MessageSquare, Award,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import type { ChatListItem, Appointment } from "../types";

interface Props {
  chatList?: ChatListItem[];
  activeSessionId?: string | null;
  credits?: number | null;
  appointments?: Appointment[];
  onNewChat?: () => void;
  onSelectChat?: (sessionId: string) => void;
  onDeleteChat?: (sessionId: string) => void;
  onLoadChats?: () => void;
}

export default function Sidebar({
  chatList = [],
  activeSessionId = null,
  credits = null,
  appointments = [],
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onLoadChats,
}: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [chatsOpen, setChatsOpen] = useState(true);
  const [apptsOpen, setApptsOpen] = useState(false);

  useEffect(() => {
    if (onLoadChats) onLoadChats();
  }, [onLoadChats]);

  const upcomingAppts = appointments.filter((a) => a.status === "confirmed" || a.status === "booked");

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <img src="/Original-Logo.png" alt="SmartAI Tutor" className="logo-img" />
        <h2>SmartAI Tutor</h2>
      </div>

      {user?.role === "student" && credits !== null && (
        <div className="credits-display">
          <Coins size={14} />
          <span>{credits.toFixed(0)} credits</span>
        </div>
      )}

      {/* Admin nav */}
      {user?.role === "admin" && (
        <div className="sidebar-nav">
          <div
            className={`nav-item ${isActive("/admin") ? "active" : ""}`}
            onClick={() => navigate("/admin")}
          >
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </div>
          <div
            className={`nav-item ${isActive("/admin/users") ? "active" : ""}`}
            onClick={() => navigate("/admin/users")}
          >
            <Users size={16} />
            <span>Users</span>
          </div>
          <div
            className={`nav-item ${isActive("/admin/chats") ? "active" : ""}`}
            onClick={() => navigate("/admin/chats")}
          >
            <MessageSquarePlus size={16} />
            <span>All Chats</span>
          </div>
          <div
            className={`nav-item ${isActive("/admin/knowledge") ? "active" : ""}`}
            onClick={() => navigate("/admin/knowledge")}
          >
            <BookOpen size={16} />
            <span>Knowledge Base</span>
          </div>
          <div
            className={`nav-item ${isActive("/appointments") ? "active" : ""}`}
            onClick={() => navigate("/appointments")}
          >
            <Calendar size={16} />
            <span>Appointments</span>
          </div>
          <div
            className={`nav-item ${isActive("/admin/assessments") ? "active" : ""}`}
            onClick={() => navigate("/admin/assessments")}
          >
            <Settings size={16} />
            <span>Assessments</span>
          </div>
        </div>
      )}

      {/* Teacher nav */}
      {user?.role === "teacher" && (
        <div className="sidebar-nav">
          <div
            className={`nav-item ${isActive("/teacher") ? "active" : ""}`}
            onClick={() => navigate("/teacher")}
          >
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </div>
          <div
            className={`nav-item ${isActive("/teacher/students") ? "active" : ""}`}
            onClick={() => navigate("/teacher/students")}
          >
            <BookOpen size={16} />
            <span>Students</span>
          </div>
          <div
            className={`nav-item ${isActive("/teacher/activity") ? "active" : ""}`}
            onClick={() => navigate("/teacher/activity")}
          >
            <Activity size={16} />
            <span>Activity</span>
          </div>
          <div
            className={`nav-item ${isActive("/teacher/knowledge") ? "active" : ""}`}
            onClick={() => navigate("/teacher/knowledge")}
          >
            <BookOpen size={16} />
            <span>Knowledge Base</span>
          </div>
          <div
            className={`nav-item ${isActive("/appointments") ? "active" : ""}`}
            onClick={() => navigate("/appointments")}
          >
            <Calendar size={16} />
            <span>Appointments</span>
          </div>
        </div>
      )}

      {/* Parent nav */}
      {user?.role === "parent" && (
        <div className="sidebar-nav">
          <div
            className={`nav-item ${isActive("/parent") ? "active" : ""}`}
            onClick={() => navigate("/parent")}
          >
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </div>
          <div
            className={`nav-item ${isActive("/parent/students") ? "active" : ""}`}
            onClick={() => navigate("/parent/students")}
          >
            <Users size={16} />
            <span>My Children</span>
          </div>
          <div
            className={`nav-item ${isActive("/appointments") ? "active" : ""}`}
            onClick={() => navigate("/appointments")}
          >
            <Calendar size={16} />
            <span>Appointments</span>
          </div>
        </div>
      )}

      {/* Student sections */}
      {user?.role === "student" && onNewChat && (
        <>
          <button className="new-chat-btn" onClick={onNewChat}>
            <MessageSquarePlus size={16} />
            New Chat
          </button>

          {/* Chats dropdown */}
          <div
            className="sidebar-section-header"
            onClick={() => setChatsOpen(!chatsOpen)}
          >
            {chatsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <MessageSquare size={14} />
            <span>Chats</span>
            <span className="section-count">{chatList.length}</span>
          </div>
          {chatsOpen && (
            <div className="chat-list">
              {chatList.map((chat) => (
                <div
                  key={chat.session_id}
                  className={`chat-list-item ${chat.session_id === activeSessionId ? "active" : ""}`}
                  onClick={() => onSelectChat?.(chat.session_id)}
                >
                  <span className="title">{chat.title}</span>
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat?.(chat.session_id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {chatList.length === 0 && (
                <div style={{ padding: "8px 14px", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No chats yet</div>
              )}
            </div>
          )}

          {/* Appointments dropdown */}
          <div
            className="sidebar-section-header"
            onClick={() => setApptsOpen(!apptsOpen)}
          >
            {apptsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Calendar size={14} />
            <span>Sessions</span>
            {upcomingAppts.length > 0 && <span className="section-count">{upcomingAppts.length}</span>}
          </div>
          {apptsOpen && (
            <div className="chat-list">
              {upcomingAppts.map((appt) => (
                <div
                  key={appt.id}
                  className="chat-list-item"
                  onClick={() => navigate(`/session/${appt.id}`)}
                >
                  <span className="title">{appt.title}</span>
                  <span style={{ fontSize: 10, color: appt.status === "confirmed" ? "#8bd4a8" : "rgba(255,255,255,0.4)" }}>
                    {appt.status === "confirmed" ? "Ready" : "Pending"}
                  </span>
                </div>
              ))}
              {upcomingAppts.length === 0 && (
                <div style={{ padding: "8px 14px", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No upcoming sessions</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Spacer to push footer down for non-student */}
      {user?.role !== "student" && <div style={{ flex: 1 }} />}

      <div className="sidebar-footer">
        <div className="user-info">
          <span>{user?.name}</span>
          <span className="role-badge">{user?.role}</span>
        </div>
        <button className="logout-btn" onClick={logout} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
