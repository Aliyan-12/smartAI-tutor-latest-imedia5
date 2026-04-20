import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LogOut, LayoutDashboard, Users, Activity,
  BookOpen, Settings, Calendar, FileText,
  Home, BarChart2, ClipboardList,
  MessageCircle, Clock, GraduationCap, Bell,
  ShieldCheck, Database, MessageSquare, BarChart,
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

const SHARED_STYLES = `
  .sb {
    width: 270px;
    background: #292929;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 100vh;
    overflow: hidden;
    font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .sb-header {
    padding: 18px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .sb-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sb-brand-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: #1a73e8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(26,115,232,0.35);
  }

  .sb-brand-text { min-width: 0; }

  .sb-brand-name {
    font-size: 14px;
    font-weight: 800;
    color: #fff;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sb-school-name {
    font-size: 11px;
    color: #636363;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .sb-nav {
    padding: 12px 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sb-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 7px;
    font-size: 13.5px;
    font-weight: 500;
    color: #94a3b8;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    position: relative;
    text-decoration: none;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    font-family: inherit;
  }

  .sb-nav-item:hover {
    background: rgba(255,255,255,0.05);
    color: #cbd5e1;
  }

  .sb-nav-item.active {
    background: rgba(26,115,232,0.15);
    color: #4d96f0;
    font-weight: 700;
    border-left: 3px solid #1a73e8;
    padding-left: 9px;
  }

  .sb-nav-item.disabled {
    opacity: 0.45;
    cursor: default;
    pointer-events: none;
  }

  .sb-badge-count {
    margin-left: auto;
    background: #1a73e8;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    min-width: 18px;
    text-align: center;
  }

  .sb-soon-badge {
    margin-left: auto;
    background: rgba(255,255,255,0.08);
    color: #64748b;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .sb-divider {
    height: 1px;
    background: rgba(255,255,255,0.06);
    margin: 6px 12px;
  }

  .sb-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .sb-section-label {
    padding: 12px 14px 4px;
    font-size: 10px;
    font-weight: 700;
    color: #4a4a4a;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .sb-time-widget {
    margin: 8px 12px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 14px;
  }

  .sb-time-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sb-time-bar-track {
    height: 8px;
    background: rgba(255,255,255,0.07);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 7px;
  }

  .sb-time-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #1a73e8, #60a5fa);
  }

  .sb-time-stats {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 10px;
  }

  .sb-time-used { font-weight: 700; color: #e2e8f0; }
  .sb-time-total { color: #475569; }

  .sb-buy-btn {
    width: 100%;
    padding: 8px;
    background: #1a73e8;
    color: #fff;
    border: none;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.2s;
  }

  .sb-buy-btn:hover { background: #1557b0; }

  .sb-spacer { flex: 1; }

  .sb-footer {
    padding: 12px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sb-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: linear-gradient(135deg, #1a73e8, #1557b0);
    color: #fff;
    font-size: 14px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sb-user-meta { flex: 1; min-width: 0; }

  .sb-user-name {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sb-user-role {
    font-size: 10px;
    font-weight: 700;
    color: #1a73e8;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 1px;
    background: rgba(26,115,232,0.12);
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .sb-logout-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.25);
    padding: 5px;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .sb-logout-btn:hover { color: #ef4444; }

  .sb-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    color: #e2e8f0;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    z-index: 9999;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }
`;

export default function Sidebar({
  chatList = [],
  activeSessionId = null,
  appointments = [],
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onLoadChats,
}: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [buyToast, setBuyToast] = useState(false);

  useEffect(() => {
    if (onLoadChats) onLoadChats();
  }, [onLoadChats]);

  const isActive = (path: string) => location.pathname === path;
  const avatarLetter = user?.name ? user.name.charAt(0).toUpperCase() : "?";

  const handleBuyTime = () => {
    setBuyToast(true);
    setTimeout(() => setBuyToast(false), 3000);
  };

  /* ── Shared Brand Header ── */
  const BrandHeader = () => (
    <div className="sb-header">
      <div className="sb-brand">
        <div className="sb-brand-icon">🤖</div>
        <div className="sb-brand-text">
          <div className="sb-brand-name">AI Tutor 4 Schools</div>
          <div className="sb-school-name">Greenfield Int. School</div>
        </div>
      </div>
    </div>
  );

  /* ── Shared Footer ── */
  const Footer = ({ roleLabel }: { roleLabel: string }) => (
    <div className="sb-footer">
      <div className="sb-avatar">{avatarLetter}</div>
      <div className="sb-user-meta">
        <div className="sb-user-name">{user?.name ?? roleLabel}</div>
        <div className="sb-user-role">{roleLabel}</div>
      </div>
      <button className="sb-logout-btn" onClick={logout} title="Sign out">
        <LogOut size={16} />
      </button>
    </div>
  );

  /* ═══════════════════════════════════════
     STUDENT
  ═══════════════════════════════════════ */
  if (user?.role === "student") {
    return (
      <>
        <style>{SHARED_STYLES}</style>
        {buyToast && (
          <div className="sb-toast">
            Subscription page coming soon — ask your school admin.
          </div>
        )}
        <div className="sb">
          <BrandHeader />

          <nav className="sb-nav">
            <button
              className={`sb-nav-item${isActive("/chat") ? " active" : ""}`}
              onClick={() => navigate("/chat")}
            >
              <Home size={16} /><span>Home</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/sessions") ? " active" : ""}`}
              onClick={() => navigate("/sessions")}
            >
              <BookOpen size={16} /><span>My Sessions</span>
            </button>
            <button className="sb-nav-item disabled">
              <GraduationCap size={16} /><span>Subjects</span>
              <span className="sb-soon-badge">Soon</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/progress") ? " active" : ""}`}
              onClick={() => navigate("/progress")}
            >
              <BarChart2 size={16} /><span>My Progress</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/assignments") ? " active" : ""}`}
              onClick={() => navigate("/assignments")}
            >
              <ClipboardList size={16} /><span>Assignments</span>
            </button>
            <button className="sb-nav-item disabled">
              <MessageCircle size={16} /><span>Messages</span>
              <span className="sb-soon-badge">Soon</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/settings") ? " active" : ""}`}
              onClick={() => navigate("/settings")}
            >
              <Settings size={16} /><span>Settings</span>
            </button>
          </nav>

          <div className="sb-divider" />

          <div className="sb-scroll">
            <div className="sb-spacer" />

            {/* Learning time widget */}
            <div className="sb-time-widget">
              <div className="sb-time-label">
                <Clock size={12} />Learning Time This Week
              </div>
              <div className="sb-time-bar-track">
                <div className="sb-time-bar-fill" style={{ width: "75%" }} />
              </div>
              <div className="sb-time-stats">
                <span className="sb-time-used">7h 30m</span>
                <span className="sb-time-total">/ 10h goal</span>
              </div>
              <button className="sb-buy-btn" onClick={handleBuyTime}>
                Buy More Time
              </button>
            </div>
          </div>

          <Footer roleLabel="Student" />
        </div>
      </>
    );
  }

  /* ═══════════════════════════════════════
     TEACHER
  ═══════════════════════════════════════ */
  if (user?.role === "teacher") {
    return (
      <>
        <style>{SHARED_STYLES}</style>
        <div className="sb">
          <BrandHeader />

          <nav className="sb-nav">
            <div className="sb-section-label">Overview</div>
            <button
              className={`sb-nav-item${isActive("/teacher") ? " active" : ""}`}
              onClick={() => navigate("/teacher")}
            >
              <LayoutDashboard size={16} /><span>Dashboard</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/teacher/students") ? " active" : ""}`}
              onClick={() => navigate("/teacher/students")}
            >
              <Users size={16} /><span>Students</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/teacher/activity") ? " active" : ""}`}
              onClick={() => navigate("/teacher/activity")}
            >
              <Activity size={16} /><span>Activity</span>
            </button>

            <div className="sb-section-label">Teaching</div>
            <button
              className={`sb-nav-item${isActive("/appointments") ? " active" : ""}`}
              onClick={() => navigate("/appointments")}
            >
              <Calendar size={16} /><span>Sessions</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/teacher/assignments") ? " active" : ""}`}
              onClick={() => navigate("/teacher/assignments")}
            >
              <ClipboardList size={16} /><span>Assignments</span>
              <span className="sb-soon-badge">Soon</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/teacher/reports") ? " active" : ""}`}
              onClick={() => navigate("/teacher/reports")}
            >
              <FileText size={16} /><span>Session Reports</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/teacher/knowledge") ? " active" : ""}`}
              onClick={() => navigate("/teacher/knowledge")}
            >
              <Database size={16} /><span>Knowledge Base</span>
            </button>

            <div className="sb-section-label">Tools</div>
            <button
              className={`sb-nav-item${isActive("/teacher/progress") ? " active" : ""}`}
              onClick={() => navigate("/teacher/progress")}
            >
              <BarChart size={16} /><span>Class Progress</span>
              <span className="sb-soon-badge">Soon</span>
            </button>
            <button className="sb-nav-item disabled">
              <Bell size={16} /><span>Notifications</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/teacher/settings") ? " active" : ""}`}
              onClick={() => navigate("/teacher/settings")}
            >
              <Settings size={16} /><span>Settings</span>
            </button>
          </nav>

          <div className="sb-scroll"><div className="sb-spacer" /></div>

          <Footer roleLabel="Teacher" />
        </div>
      </>
    );
  }

  /* ═══════════════════════════════════════
     PARENT
  ═══════════════════════════════════════ */
  if (user?.role === "parent") {
    return (
      <>
        <style>{SHARED_STYLES}</style>
        <div className="sb">
          <BrandHeader />

          <nav className="sb-nav">
            <div className="sb-section-label">Overview</div>
            <button
              className={`sb-nav-item${isActive("/parent") ? " active" : ""}`}
              onClick={() => navigate("/parent")}
            >
              <LayoutDashboard size={16} /><span>Dashboard</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/parent/students") ? " active" : ""}`}
              onClick={() => navigate("/parent/students")}
            >
              <Users size={16} /><span>My Children</span>
            </button>

            <div className="sb-section-label">Learning</div>
            <button
              className={`sb-nav-item${isActive("/appointments") ? " active" : ""}`}
              onClick={() => navigate("/appointments")}
            >
              <Calendar size={16} /><span>Book Sessions</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/parent/reports") ? " active" : ""}`}
              onClick={() => navigate("/parent/reports")}
            >
              <FileText size={16} /><span>Session Reports</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/parent/progress") ? " active" : ""}`}
              onClick={() => navigate("/parent/progress")}
            >
              <BarChart2 size={16} /><span>Progress Tracker</span>
              <span className="sb-soon-badge">Soon</span>
            </button>

            <div className="sb-section-label">Account</div>
            <button className="sb-nav-item disabled">
              <MessageSquare size={16} /><span>Messages</span>
            </button>
            <button className="sb-nav-item disabled">
              <Bell size={16} /><span>Notifications</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/parent/settings") ? " active" : ""}`}
              onClick={() => navigate("/parent/settings")}
            >
              <Settings size={16} /><span>Settings</span>
            </button>
          </nav>

          <div className="sb-scroll"><div className="sb-spacer" /></div>

          <Footer roleLabel="Parent" />
        </div>
      </>
    );
  }

  /* ═══════════════════════════════════════
     ADMIN
  ═══════════════════════════════════════ */
  if (user?.role === "admin") {
    return (
      <>
        <style>{SHARED_STYLES}</style>
        <div className="sb">
          <BrandHeader />

          <nav className="sb-nav">
            <div className="sb-section-label">Management</div>
            <button
              className={`sb-nav-item${isActive("/admin") ? " active" : ""}`}
              onClick={() => navigate("/admin")}
            >
              <LayoutDashboard size={16} /><span>Dashboard</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/admin/users") ? " active" : ""}`}
              onClick={() => navigate("/admin/users")}
            >
              <Users size={16} /><span>Users</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/admin/assessments") ? " active" : ""}`}
              onClick={() => navigate("/admin/assessments")}
            >
              <ClipboardList size={16} /><span>Assessments</span>
            </button>

            <div className="sb-section-label">Platform</div>
            <button
              className={`sb-nav-item${isActive("/appointments") ? " active" : ""}`}
              onClick={() => navigate("/appointments")}
            >
              <Calendar size={16} /><span>All Sessions</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/admin/knowledge") ? " active" : ""}`}
              onClick={() => navigate("/admin/knowledge")}
            >
              <Database size={16} /><span>Knowledge Base</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/admin/reports") ? " active" : ""}`}
              onClick={() => navigate("/admin/reports")}
            >
              <FileText size={16} /><span>Reports</span>
              <span className="sb-soon-badge">Soon</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/admin/chats") ? " active" : ""}`}
              onClick={() => navigate("/admin/chats")}
            >
              <MessageSquare size={16} /><span>All Chats</span>
            </button>

            <div className="sb-section-label">Analytics</div>
            <button
              className={`sb-nav-item${isActive("/admin/activity") ? " active" : ""}`}
              onClick={() => navigate("/admin/activity")}
            >
              <Activity size={16} /><span>Activity Log</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/admin/analytics") ? " active" : ""}`}
              onClick={() => navigate("/admin/analytics")}
            >
              <BarChart size={16} /><span>Analytics</span>
              <span className="sb-soon-badge">Soon</span>
            </button>

            <div className="sb-section-label">System</div>
            <button
              className={`sb-nav-item${isActive("/admin/security") ? " active" : ""}`}
              onClick={() => navigate("/admin/security")}
            >
              <ShieldCheck size={16} /><span>Security</span>
              <span className="sb-soon-badge">Soon</span>
            </button>
            <button
              className={`sb-nav-item${isActive("/settings") ? " active" : ""}`}
              onClick={() => navigate("/settings")}
            >
              <Settings size={16} /><span>Settings</span>
            </button>
          </nav>

          <div className="sb-scroll"><div className="sb-spacer" /></div>

          <Footer roleLabel="Admin" />
        </div>
      </>
    );
  }

  /* Fallback */
  return null;
}
