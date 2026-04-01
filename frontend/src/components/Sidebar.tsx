import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  MessageSquarePlus, Trash2, LogOut, Coins,
  LayoutDashboard, Users, Activity, Shield,
  BookOpen, Settings,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import type { ChatListItem } from "../types";

interface Props {
  chatList?: ChatListItem[];
  activeSessionId?: string | null;
  credits?: number | null;
  onNewChat?: () => void;
  onSelectChat?: (sessionId: string) => void;
  onDeleteChat?: (sessionId: string) => void;
  onLoadChats?: () => void;
}

export default function Sidebar({
  chatList = [],
  activeSessionId = null,
  credits = null,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onLoadChats,
}: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (onLoadChats) onLoadChats();
  }, [onLoadChats]);

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
        </div>
      )}

      {/* Student chat controls */}
      {user?.role === "student" && onNewChat && (
        <>
          <button className="new-chat-btn" onClick={onNewChat}>
            <MessageSquarePlus size={16} />
            New Chat
          </button>

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
          </div>
        </>
      )}

      {/* Spacer to push footer down for admin/teacher */}
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
