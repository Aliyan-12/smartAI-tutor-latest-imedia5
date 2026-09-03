import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, Menu, X, Plus, MessageSquare } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { adminApi, chatApi } from "../services/api";
import NotificationBell from "./NotificationBell";
import { getNavForRole, roleLabel, type NavItem } from "../lib/navigation";
import type { ChatListItem, Appointment } from "../types";

// Props are accepted for backwards-compatibility with existing callers (e.g. ChatPage still
// passes chat props). The sidebar no longer renders an inline chat list — "Chats" is a single
// destination in the registry — so these are intentionally unused here.
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

  /* Student chat history sub-items under the "Chats" nav entry */
  .sb-chat-sub {
    padding-left: 34px;
    font-size: 12.5px;
    gap: 8px;
  }
  .sb-chat-new { font-weight: 700; color: var(--accent); }
  .sb-chat-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-chat-empty {
    padding: 4px 12px 8px 34px;
    font-size: 11.5px;
    color: #94a3b8;
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeUsersCount, setActiveUsersCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [chats, setChats] = useState<ChatListItem[]>([]);

  // Student chat history — powers the New Chat + list under the "Chats" nav item.
  // Re-fetched on navigation so a chat the student just started appears without a refresh.
  useEffect(() => {
    if (user?.role !== "student") return;
    chatApi.listChats()
      .then((list) => setChats(Array.isArray(list) ? (list as ChatListItem[]) : []))
      .catch(() => {});
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

  // Auto-close the mobile drawer when the route changes (e.g. browser back/forward).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when the drawer is open on mobile.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const isActive = (path: string) => location.pathname === path;
  const avatarLetter = user?.name ? user.name.charAt(0).toUpperCase() : "?";

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

      {/* Sidebar panel */}
      <div className={`sb${mobileOpen ? " sb-open" : ""}`}>
        {children}
      </div>
    </>
  );

  // Runtime badge values, resolved from a NavItem's badgeKey.
  const badges: Record<string, number | null> = {
    activeUsers: activeUsersCount,
    pendingApprovals: pendingCount,
  };
  const itemActive = (it: NavItem) =>
    it.activePrefix ? location.pathname.startsWith(it.path) : isActive(it.path);

  // Sidebar is now a RENDERER over the central navigation registry (lib/navigation).
  const sections = getNavForRole(user?.role);
  if (sections.length === 0) return null;

  return (
    <Wrapper>
      <BrandHeader />
      <nav className="sb-nav">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && <div className="sb-section-label">{section.label}</div>}
            {section.items.map((it) => {
              const Icon = it.icon;
              const active = itemActive(it);
              const badge = it.badgeKey ? badges[it.badgeKey] : null;
              const navBtn = (
                <button
                  className={`sb-nav-item${active ? " active" : ""}`}
                  onClick={() => go(it.path)}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={16} /><span>{it.label}</span>
                  {badge != null && badge > 0 && (
                    <span style={{ marginLeft: "auto", background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "1px 7px", lineHeight: 1.6 }}>{badge}</span>
                  )}
                </button>
              );
              // Student "Chats": the destination link, a New Chat action, then the chat history.
              if (it.id !== "s-chat") return <div key={it.id}>{navBtn}</div>;
              return (
                <div key={it.id}>
                  {navBtn}
                  <button className="sb-nav-item sb-chat-sub sb-chat-new" onClick={() => go("/chat")}>
                    <Plus size={15} /><span>New Chat</span>
                  </button>
                  {chats.map((c) => {
                    const chatActive = location.pathname === `/chat/${c.session_id}`;
                    return (
                      <button key={c.session_id} className={`sb-nav-item sb-chat-sub${chatActive ? " active" : ""}`}
                        onClick={() => go(`/chat/${c.session_id}`)} title={c.title || "Chat"}>
                        <MessageSquare size={14} /><span className="sb-chat-title">{c.title || "Untitled chat"}</span>
                      </button>
                    );
                  })}
                  {chats.length === 0 && <div className="sb-chat-empty">No chats yet — start one!</div>}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <Footer roleLabel={roleLabel(user?.role)} />
    </Wrapper>
  );
}
