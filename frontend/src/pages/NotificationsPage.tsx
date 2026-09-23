import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, CheckCheck } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { notificationsApi, type AppNotification } from "../services/api";
import { PageHeader, Card, CardBody, Button, Badge, Spinner, EmptyState } from "../components/ui";

/**
 * Full-page notification centre. Renders the SAME data as the header bell (no new API,
 * no new feature) so the "Notifications" nav destination is real rather than disabled.
 */
export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const r = await notificationsApi.list();
      setItems(r.notifications);
      setUnread(r.unread);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (n: AppNotification) => {
    if (!n.read) { await notificationsApi.markRead(n.id).catch(() => {}); }
    if (n.link) navigate(n.link); else load();
  };
  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => {});
    setItems((its) => its?.map((n) => ({ ...n, read: true })) ?? its);
    setUnread(0);
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader
            title="Notifications"
            subtitle="Updates about your account, sessions, reports and billing."
            actions={unread > 0 ? (
              <Button size="sm" variant="secondary" leftIcon={<CheckCheck size={15} />} onClick={markAll}>
                Mark all read
              </Button>
            ) : undefined}
          />

          {!items ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : items.length === 0 ? (
            <EmptyState icon={<Bell size={36} />} title="You're all caught up"
              description="New notifications will appear here." />
          ) : (
            <Card className="max-w-3xl">
              <CardBody className="pt-2">
                {items.map((n) => (
                  <button key={n.id} onClick={() => open(n)}
                    className="w-full text-left flex gap-3 py-3 border-b border-line last:border-0 hover:bg-surface-muted transition-colors rounded-md px-2 -mx-2">
                    <div className="mt-0.5 shrink-0">
                      {n.read ? <Check size={16} className="text-ink-muted" /> : <span className="block w-2.5 h-2.5 rounded-full bg-brand mt-1" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`t-body font-semibold ${n.read ? "text-ink-muted" : "text-ink"}`}>{n.title}</span>
                        {!n.read && <Badge tone="brand">New</Badge>}
                      </div>
                      {n.body && <div className="t-helper mt-0.5">{n.body}</div>}
                      <div className="t-helper mt-0.5 text-ink-muted">{new Date(n.created_at).toLocaleString()}</div>
                    </div>
                  </button>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
