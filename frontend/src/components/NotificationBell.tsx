import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { notificationsApi, type AppNotification } from "../services/api";

/** Bell + dropdown notification centre. Polls the unread count on a light interval and
 * loads the list on open. Safe to mount in any role's sidebar. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const refreshCount = useCallback(() => {
    notificationsApi.unreadCount().then((r) => setUnread(r.unread)).catch(() => {});
  }, []);
  useEffect(() => {
    refreshCount();
    const t = window.setInterval(refreshCount, 60000);
    return () => window.clearInterval(t);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    notificationsApi.list().then((r) => { setItems(r.notifications); setUnread(r.unread); }).catch(() => setItems([]));
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openItem = async (n: AppNotification) => {
    if (!n.read) { await notificationsApi.markRead(n.id).catch(() => {}); setUnread((u) => Math.max(0, u - 1)); }
    setOpen(false);
    if (n.link) navigate(n.link);
  };
  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => {});
    setItems((its) => its?.map((n) => ({ ...n, read: true })) ?? its); setUnread(0);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-[var(--bg-hover,rgba(0,0,0,0.05))] transition-colors"
        style={{ color: "var(--text-secondary)" }}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[420px] overflow-y-auto rounded-xl border shadow-lg z-50"
          style={{ background: "var(--surface, #fff)", borderColor: "var(--border, #e2e8f0)" }}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--border, #e2e8f0)" }}>
            <span className="font-bold text-[13px]" style={{ color: "var(--text-primary)" }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-[12px] font-semibold flex items-center gap-1" style={{ color: "var(--accent, #3b82f6)" }}>
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>
          {!items ? (
            <div className="px-3 py-6 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>You're all caught up.</div>
          ) : (
            items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)}
                className="w-full text-left px-3 py-2.5 border-b hover:bg-[var(--bg-hover,rgba(0,0,0,0.03))] transition-colors flex gap-2"
                style={{ borderColor: "var(--border, #eef2f7)" }}>
                {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: "var(--accent, #3b82f6)" }} />}
                <div className={n.read ? "opacity-70" : ""} style={{ marginLeft: n.read ? 16 : 0 }}>
                  <div className="font-semibold text-[13px]" style={{ color: "var(--text-primary)" }}>{n.title}</div>
                  {n.body && <div className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{n.body}</div>}
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{new Date(n.created_at).toLocaleString()}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
