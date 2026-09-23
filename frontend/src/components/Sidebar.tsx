import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LogOut, LayoutDashboard, Users, Activity,
  BookOpen, Settings, Calendar, FileText,
  BarChart2, ClipboardList,
  MessageCircle, Clock, GraduationCap, Bell,
  ShieldCheck, Database, MessageSquare, BarChart,
  Menu, X, ChevronDown, Sparkles, CreditCard,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { chatApi, adminApi } from "../services/api";
import NotificationBell from "./NotificationBell";
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
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 100vh;
    overflow: hidden;
    font-family: var(--font);
    transition: transform 0.27s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .sb-header {
    padding: 10px 12px 12px;
    border-bottom: 1px solid var(--border);
  }

  .sb-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
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

  .sb-brand-text { min-width: 0; flex: 1; }

  .sb-brand-name {
    font-size: 14px;
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sb-school-name {
    font-size: 11px;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .sb-nav {
    padding: 12px 10px 8px;
    display: flex;
    flex-direction: column;
    overflow-y: scroll;
    gap: 1px;
  }

  .sb-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 9px;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--sidebar-text);
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
    background: var(--sidebar-hover);
    color: var(--text-primary);
  }

  .sb-nav-item:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-muted);
  }

  .sb-nav-item.active {
    background: var(--sidebar-active);
    color: var(--accent);
    font-weight: 700;
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
    background: rgba(0,0,0,0.05);
    color: #64748b;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .sb-divider {
    height: 1px;
    background: var(--border);
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
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .sb-time-widget {
    margin: 8px 12px;
    background: #f8fafc;
    border: 1px solid var(--border);
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
    background: var(--border);
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

  .sb-time-used { font-weight: 700; color: var(--text-primary); }
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
    border-top: 1px solid var(--border);
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
    color: var(--text-primary);
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
    color: #94a3b8;
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
    color: var(--border);
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    z-index: 9999;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }

  /* ── Hamburger trigger (mobile / tablet) ── */
  .sb-hamburger {
    display: none;
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 1001;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 8px 11px;
    color: var(--text-primary);
    cursor: pointer;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 700;
    font-family: var(--font);
    box-shadow: 0 2px 14px rgba(0,0,0,0.45);
    transition: background 0.15s, border-color 0.15s;
  }
  .sb-hamburger:hover { background: #f1f5f9; border-color: #cbd5e1; }

  /* ── Backdrop overlay ── */
  .sb-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.62);
    z-index: 998;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }
  .sb-backdrop.open { opacity: 1; pointer-events: auto; }

  /* ── Close button inside sidebar header ── */
  .sb-close-btn {
    display: none;
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 5px;
    border-radius: 6px;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-left: auto;
    transition: color 0.15s, background 0.15s;
  }
  .sb-close-btn:hover { color: var(--text-primary); background: rgba(0,0,0,0.05); }

  /* ── Responsive breakpoints ── */
  @media (max-width: 1023px) {
    .sb-hamburger { display: flex; }
    .sb-close-btn { display: flex; }
    .sb {
      position: fixed;
      top: 0;
      left: 0;
      height: 100dvh;
      z-index: 999;
      transform: translateX(-100%);
      box-shadow: 6px 0 40px rgba(0,0,0,0.12);
      border-right: 1px solid var(--border);
    }
    .sb.sb-open { transform: translateX(0); }
  }

  @media (min-width: 1024px) {
    .sb-hamburger { display: none !important; }
    .sb-backdrop { display: none !important; }
    .sb-close-btn { display: none !important; }
    .sb { position: relative; transform: none !important; box-shadow: none; }
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [internalChats, setInternalChats] = useState<ChatListItem[]>(chatList);
  const [activeUsersCount, setActiveUsersCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const loadInternalChats = () => {
    if (user?.role === "student") {
      chatApi.listChats()
        .then((data) => setInternalChats(data as ChatListItem[]))
        .catch(() => {});
    }
  };

  // Sync from prop when parent (ChatPage) refreshes its list via useChat
  useEffect(() => {
    if (chatList.length > 0) {
      setInternalChats(chatList);
    }
  }, [chatList]);

  // Fetch independently on page navigation (for pages that don't pass chatList)
  useEffect(() => {
    loadInternalChats();
    if (onLoadChats) onLoadChats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, location.pathname]);

  // Admin/administrator sidebar count badges (active users + pending approvals).
  // Re-fetched on navigation so they refresh after approve/reject + add/remove.
  useEffect(() => {
    if (user?.role !== "admin" && user?.role !== "administrator") return;
    adminApi.getDashboard()
      .then((d) => setActiveUsersCount((d as { total_users?: number })?.total_users ?? null))
      .catch(() => {});
    if (user?.role === "administrator") {
      adminApi.getPendingApprovals()
        .then((d) => setPendingCount(Array.isArray(d) ? d.length : null))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, location.pathname]);

  const handleDeleteChat = async (sessionId: string) => {
    try {
      if (onDeleteChat) {
        // Parent (ChatPage) handles the API call + navigation + state reset
        onDeleteChat(sessionId);
      } else {
        await chatApi.deleteChat(sessionId);
        if (activeSessionId === sessionId) navigate("/chat");
      }
      setInternalChats((prev) => prev.filter((c) => c.session_id !== sessionId));
    } catch (_) {}
  };

  // Auto-close sidebar when route changes (e.g. browser back/forward)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const isActive = (path: string) => location.pathname === path;
  const avatarLetter = user?.name ? user.name.charAt(0).toUpperCase() : "?";
  const toggleDropdown = (id: string) => setOpenDropdown((prev) => (prev === id ? null : id));

  const handleBuyTime = () => {
    setBuyToast(true);
    setTimeout(() => setBuyToast(false), 3000);
  };

  const go = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const close = () => setMobileOpen(false);

  /* ── Shared Brand Header (with close button) ── */
  const BrandHeader = () => (
    <div className="sb-header">
      <div className="sb-brand">
        <img
          src="/images/aitutor 4 schools-robo.png"
          alt="AI Tutor 4 Schools"
          style={{ height: 52, width: "auto", objectFit: "contain", flexShrink: 0 }}
        />
        <div className="sb-brand-text">
          <div className="sb-brand-name" style={{ fontSize: 17, fontWeight: 900 }}>AI Tutor <span style={{ color: "#f97316" }}>4</span> Schools</div>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>AI-Powered Education</div>
        </div>
        <NotificationBell />
        <button className="sb-close-btn" onClick={close} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      {/* School badge row */}
      <div style={{
        marginTop: 10,
        display: "flex", alignItems: "center", gap: 9,
        padding: "7px 10px",
        background: "#f1f5f9",
        borderRadius: 10,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          background: "#fff", border: "1.5px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, overflow: "hidden",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}>
          <img src="/images/smarttuition-logo.png" style={{ width: 32, height: 32, objectFit: "contain" }} alt={user?.school_name ?? "School"} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.role === "administrator" ? "All Schools" : (user?.school_name ?? "Smart Tuition")}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.role === "administrator" ? "Platform Administrator" : (user?.school_country ?? "United Kingdom & United Arab Emirates")}
          </div>
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

  /* ── Shared outer wrapper (hamburger + backdrop + sidebar) ── */
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <>
      <style>{SHARED_STYLES}</style>

      {/* Hamburger trigger — hidden while sidebar is open (X button in header handles close) */}
      {!mobileOpen && (
        <button
          className="sb-hamburger"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>
      )}

      {/* Translucent backdrop — closes sidebar on tap */}
      <div
        className={`sb-backdrop${mobileOpen ? " open" : ""}`}
        onClick={close}
        aria-hidden="true"
      />

      {buyToast && (
        <div className="sb-toast">
          Subscription page coming soon — ask your school admin.
        </div>
      )}

      {/* Sidebar panel */}
      <div className={`sb${mobileOpen ? " sb-open" : ""}`}>
        {children}
      </div>
    </>
  );

  /* ═══════════════════════════════════════
     STUDENT
  ═══════════════════════════════════════ */
  if (user?.role === "student") {
    return (
      <Wrapper>
        <BrandHeader />

        <nav className="sb-nav">
          <button
            className={`sb-nav-item${isActive("/student/dashboard") ? " active" : ""}`}
            onClick={() => go("/student/dashboard")}
          >
            <LayoutDashboard size={16} /><span>Dashboard</span>
          </button>

          {/* Chats dropdown */}
          <button
            className={`sb-nav-item${location.pathname.startsWith("/chat") ? " active" : ""}`}
            onClick={() => toggleDropdown("chats")}
            style={{ justifyContent: "space-between" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <MessageCircle size={16} /><span>Chats</span>
            </span>
            <ChevronDown size={14} style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: openDropdown === "chats" ? "rotate(180deg)" : "none" }} />
          </button>

          {openDropdown === "chats" && (
            <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 1 }}>
              <button
                className="sb-nav-item"
                style={{ fontSize: 12, color: "#1a73e8", paddingTop: 6, paddingBottom: 6 }}
                onClick={() => { navigate("/chat"); if (onNewChat) onNewChat(); }}
              >
                <span style={{ fontSize: 14 }}>＋</span><span>New Chat</span>
              </button>
              {(() => {
                const regularChats = internalChats.filter((c) => !c.title.toLowerCase().startsWith("[session:"));
                if (regularChats.length === 0) {
                  return <div style={{ fontSize: 12, color: "#475569", padding: "6px 12px" }}>No chats yet</div>;
                }
                return regularChats.slice(0, 10).map((chat) => (
                <div key={chat.session_id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <button
                    className={`sb-nav-item${activeSessionId === chat.session_id ? " active" : ""}`}
                    style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6, flex: 1, minWidth: 0 }}
                    onClick={() => { navigate(`/chat/${chat.session_id}`); if (onSelectChat) onSelectChat(chat.session_id); }}
                    title={chat.title || "Chat"}
                  >
                    <MessageSquare size={13} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {chat.title || "Untitled Chat"}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.session_id); }}
                    title="Delete chat"
                    style={{
                      background: "none", border: "none", color: "#cbd5e1",
                      cursor: "pointer", padding: "4px 5px", borderRadius: 5, flexShrink: 0,
                      fontSize: 13, lineHeight: 1, transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#cbd5e1")}
                  >
                    ×
                  </button>
                </div>
                ));
              })()}
            </div>
          )}

          {/* Sessions dropdown */}
          <button
            className={`sb-nav-item${location.pathname.startsWith("/sessions") || location.pathname.startsWith("/session") || isActive("/lesson/setup") ? " active" : ""}`}
            onClick={() => toggleDropdown("sessions")}
            style={{ justifyContent: "space-between" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <BookOpen size={16} /><span>Sessions</span>
            </span>
            <ChevronDown size={14} style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: openDropdown === "sessions" ? "rotate(180deg)" : "none" }} />
          </button>

          {openDropdown === "sessions" && (
            <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 1 }}>
              <button
                className={`sb-nav-item${isActive("/lesson/setup") ? " active" : ""}`}
                style={{ fontSize: 12, color: "#1a73e8", paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/lesson/setup")}
              >
                <span style={{ fontSize: 14 }}>＋</span><span>Start a Lesson</span>
              </button>
              <button
                className={`sb-nav-item${isActive("/sessions") ? " active" : ""}`}
                style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/sessions")}
              >
                <Calendar size={13} /><span>My Sessions</span>
              </button>
            </div>
          )}
          <button
            className={`sb-nav-item${isActive("/progress") ? " active" : ""}`}
            onClick={() => go("/progress")}
          >
            <BarChart2 size={16} /><span>My Progress</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/assignments") ? " active" : ""}`}
            onClick={() => go("/assignments")}
          >
            <ClipboardList size={16} /><span>Assignments</span>
          </button>
          <button className="sb-nav-item disabled">
            <MessageCircle size={16} /><span>Messages</span>
            <span className="sb-soon-badge">Soon</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/preferences") ? " active" : ""}`}
            onClick={() => go("/preferences")}
          >
            <Sparkles size={16} /><span>Preferences</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/settings") ? " active" : ""}`}
            onClick={() => go("/settings")}
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
      </Wrapper>
    );
  }

  /* ═══════════════════════════════════════
     TEACHER
  ═══════════════════════════════════════ */
  if (user?.role === "teacher") {
    return (
      <Wrapper>
        <BrandHeader />

        <nav className="sb-nav">
          <div className="sb-section-label">Overview</div>
          <button
            className={`sb-nav-item${isActive("/teacher/dashboard") ? " active" : ""}`}
            onClick={() => go("/teacher/dashboard")}
          >
            <LayoutDashboard size={16} /><span>Dashboard</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/teacher/students") ? " active" : ""}`}
            onClick={() => go("/teacher/students")}
          >
            <Users size={16} /><span>Students</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/teacher/activity") ? " active" : ""}`}
            onClick={() => go("/teacher/activity")}
          >
            <Activity size={16} /><span>Activity</span>
          </button>

          <div className="sb-section-label">Teaching</div>
          {/* Sessions dropdown */}
          <button
            className={`sb-nav-item${(location.pathname.startsWith("/appointments") || isActive("/teacher/reports")) ? " active" : ""}`}
            onClick={() => toggleDropdown("sessions")}
            style={{ justifyContent: "space-between" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Calendar size={16} /><span>Sessions</span>
            </span>
            <ChevronDown size={14} style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: openDropdown === "sessions" ? "rotate(180deg)" : "none" }} />
          </button>

          {openDropdown === "sessions" && (
            <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 1 }}>
              <button
                className={`sb-nav-item${isActive("/appointments/new") ? " active" : ""}`}
                style={{ fontSize: 12, color: "#1a73e8", paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/appointments/new")}
              >
                <span style={{ fontSize: 14 }}>＋</span><span>New Session</span>
              </button>
              <button
                className={`sb-nav-item${isActive("/appointments") ? " active" : ""}`}
                style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/appointments")}
              >
                <Calendar size={13} /><span>All Sessions</span>
              </button>
              <button
                className={`sb-nav-item${isActive("/teacher/reports") ? " active" : ""}`}
                style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/teacher/reports")}
              >
                <FileText size={13} /><span>Session Reports</span>
              </button>
            </div>
          )}

          <button
            className={`sb-nav-item${isActive("/teacher/assignments") ? " active" : ""}`}
            onClick={() => go("/teacher/assignments")}
          >
            <ClipboardList size={16} /><span>Assignments</span>
            <span className="sb-soon-badge">Soon</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/teacher/knowledge") ? " active" : ""}`}
            onClick={() => go("/teacher/knowledge")}
          >
            <Database size={16} /><span>Knowledge Base</span>
          </button>

          <div className="sb-section-label">Tools</div>
          <button
            className={`sb-nav-item${isActive("/teacher/progress") ? " active" : ""}`}
            onClick={() => go("/teacher/progress")}
          >
            <BarChart size={16} /><span>Class Progress</span>
          </button>
          <button className="sb-nav-item disabled">
            <Bell size={16} /><span>Notifications</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/teacher/settings") ? " active" : ""}`}
            onClick={() => go("/teacher/settings")}
          >
            <Settings size={16} /><span>Settings</span>
          </button>
        </nav>

        <div className="sb-scroll"><div className="sb-spacer" /></div>

        <Footer roleLabel="Teacher" />
      </Wrapper>
    );
  }

  /* ═══════════════════════════════════════
     PARENT
  ═══════════════════════════════════════ */
  if (user?.role === "parent") {
    return (
      <Wrapper>
        <BrandHeader />

        <nav className="sb-nav">
          <div className="sb-section-label">Overview</div>
          <button
            className={`sb-nav-item${isActive("/parent/dashboard") ? " active" : ""}`}
            onClick={() => go("/parent/dashboard")}
          >
            <LayoutDashboard size={16} /><span>Dashboard</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/parent/students") ? " active" : ""}`}
            onClick={() => go("/parent/students")}
          >
            <Users size={16} /><span>My Children</span>
          </button>

          <div className="sb-section-label">Learning</div>
          {/* Sessions dropdown */}
          <button
            className={`sb-nav-item${(location.pathname.startsWith("/appointments") || isActive("/parent/reports")) ? " active" : ""}`}
            onClick={() => toggleDropdown("sessions")}
            style={{ justifyContent: "space-between" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Calendar size={16} /><span>Sessions</span>
            </span>
            <ChevronDown size={14} style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: openDropdown === "sessions" ? "rotate(180deg)" : "none" }} />
          </button>

          {openDropdown === "sessions" && (
            <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 1 }}>
              <button
                className={`sb-nav-item${isActive("/appointments/new") ? " active" : ""}`}
                style={{ fontSize: 12, color: "#1a73e8", paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/appointments/new")}
              >
                <span style={{ fontSize: 14 }}>＋</span><span>New Session</span>
              </button>
              <button
                className={`sb-nav-item${isActive("/appointments") ? " active" : ""}`}
                style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/appointments")}
              >
                <Calendar size={13} /><span>All Sessions</span>
              </button>
              <button
                className={`sb-nav-item${isActive("/parent/reports") ? " active" : ""}`}
                style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}
                onClick={() => go("/parent/reports")}
              >
                <FileText size={13} /><span>Session Reports</span>
              </button>
            </div>
          )}
          <button
            className={`sb-nav-item${isActive("/parent/progress") ? " active" : ""}`}
            onClick={() => go("/parent/progress")}
          >
            <BarChart2 size={16} /><span>Progress Tracker</span>
          </button>

          <div className="sb-section-label">Account</div>
          <button
            className={`sb-nav-item${isActive("/billing") ? " active" : ""}`}
            onClick={() => go("/billing")}
          >
            <CreditCard size={16} /><span>Billing</span>
          </button>
          <button className="sb-nav-item disabled">
            <MessageSquare size={16} /><span>Messages</span>
          </button>
          <button className="sb-nav-item disabled">
            <Bell size={16} /><span>Notifications</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/parent/settings") ? " active" : ""}`}
            onClick={() => go("/parent/settings")}
          >
            <Settings size={16} /><span>Settings</span>
          </button>
        </nav>

        <div className="sb-scroll"><div className="sb-spacer" /></div>

        <Footer roleLabel="Parent" />
      </Wrapper>
    );
  }

  /* ═══════════════════════════════════════
     ADMIN  (and platform ADMINISTRATOR — same nav, unscoped)
  ═══════════════════════════════════════ */
  if (user?.role === "admin" || user?.role === "administrator") {
    return (
      <Wrapper>
        <BrandHeader />

        <nav className="sb-nav">
          <div className="sb-section-label">Management</div>
          <button
            className={`sb-nav-item${isActive("/admin/dashboard") ? " active" : ""}`}
            onClick={() => go("/admin/dashboard")}
          >
            <LayoutDashboard size={16} /><span>Dashboard</span>
          </button>
          {/* Users dropdown — Active users (+ Pending approvals for administrators) */}
          <button
            className={`sb-nav-item${(isActive("/admin/users") || isActive("/admin/approvals")) ? " active" : ""}`}
            onClick={() => toggleDropdown("users")}
            style={{ justifyContent: "space-between" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Users size={16} /><span>Users</span>
            </span>
            <ChevronDown size={14} style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: openDropdown === "users" ? "rotate(180deg)" : "none" }} />
          </button>
          {openDropdown === "users" && (
            <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 1 }}>
              <button
                className={`sb-nav-item${isActive("/admin/users") ? " active" : ""}`}
                style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6, justifyContent: "space-between" }}
                onClick={() => go("/admin/users")}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Users size={13} /><span>Active Users</span>
                </span>
                {activeUsersCount != null && (
                  <span style={{ fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: "var(--border)", color: "#475569" }}>
                    {activeUsersCount}
                  </span>
                )}
              </button>
              {user?.role === "administrator" && (
                <button
                  className={`sb-nav-item${isActive("/admin/approvals") ? " active" : ""}`}
                  style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6, justifyContent: "space-between" }}
                  onClick={() => go("/admin/approvals")}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13 }}>⏳</span><span>Pending Approvals</span>
                  </span>
                  {pendingCount != null && pendingCount > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: "#fef3c7", color: "#b45309" }}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
          {user?.role === "administrator" && (
            <button
              className={`sb-nav-item${isActive("/admin/school-verification") ? " active" : ""}`}
              onClick={() => go("/admin/school-verification")}
            >
              <ShieldCheck size={16} /><span>School Verification</span>
            </button>
          )}
          {user?.role === "admin" && (
            <button
              className={`sb-nav-item${isActive("/school/verification") ? " active" : ""}`}
              onClick={() => go("/school/verification")}
            >
              <ShieldCheck size={16} /><span>Verification</span>
            </button>
          )}
          <button
            className={`sb-nav-item${isActive("/admin/assessments") ? " active" : ""}`}
            onClick={() => go("/admin/assessments")}
          >
            <ClipboardList size={16} /><span>Assessments</span>
          </button>

          <div className="sb-section-label">Platform</div>
          <button
            className={`sb-nav-item${isActive("/appointments") ? " active" : ""}`}
            onClick={() => go("/appointments")}
          >
            <Calendar size={16} /><span>All Sessions</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/admin/knowledge") ? " active" : ""}`}
            onClick={() => go("/admin/knowledge")}
          >
            <Database size={16} /><span>Knowledge Base</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/admin/reports") ? " active" : ""}`}
            onClick={() => go("/admin/reports")}
          >
            <FileText size={16} /><span>Reports</span>
            <span className="sb-soon-badge">Soon</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/admin/chats") ? " active" : ""}`}
            onClick={() => go("/admin/chats")}
          >
            <MessageSquare size={16} /><span>All Chats</span>
          </button>

          <div className="sb-section-label">Analytics</div>
          <button
            className={`sb-nav-item${isActive("/admin/activity") ? " active" : ""}`}
            onClick={() => go("/admin/activity")}
          >
            <Activity size={16} /><span>Activity Log</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/admin/analytics") ? " active" : ""}`}
            onClick={() => go("/admin/analytics")}
          >
            <BarChart size={16} /><span>Analytics</span>
            <span className="sb-soon-badge">Soon</span>
          </button>

          <div className="sb-section-label">System</div>
          <button
            className={`sb-nav-item${isActive("/admin/security") ? " active" : ""}`}
            onClick={() => go("/admin/security")}
          >
            <ShieldCheck size={16} /><span>Security</span>
            <span className="sb-soon-badge">Soon</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/school/billing") ? " active" : ""}`}
            onClick={() => go("/school/billing")}
          >
            <CreditCard size={16} /><span>Billing</span>
          </button>
          <button
            className={`sb-nav-item${isActive("/admin/settings") ? " active" : ""}`}
            onClick={() => go("/admin/settings")}
          >
            <Settings size={16} /><span>Settings</span>
          </button>
        </nav>

        <div className="sb-scroll"><div className="sb-spacer" /></div>

        <Footer roleLabel="Admin" />
      </Wrapper>
    );
  }

  /* Fallback */
  return null;
}
