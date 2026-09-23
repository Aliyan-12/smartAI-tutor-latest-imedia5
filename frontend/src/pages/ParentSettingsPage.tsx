import { useCallback, useEffect, useState } from "react";
import {
  Users, ShieldCheck, Lock, CreditCard,
  Trash2, Link2 as LinkIcon, Plus, Check,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import {
  parentSettingsApi, legalApi,
  type ParentProfile, type ChildSummary, type ParentBilling,
} from "../services/api";
import {
  PageHeader, Card, CardBody, CardHeader, Button, Badge, Alert, Spinner, EmptyState,
  Input, FormField, Switch, Tabs,
} from "../components/ui";

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "children", label: "Children" },
  { key: "notifications", label: "Notifications" },
  { key: "account", label: "Account" },
  { key: "privacy", label: "Privacy" },
  { key: "billing", label: "Billing" },
];
const NOTIFICATION_LABELS: Record<string, string> = {
  session_reminders: "Session reminders",
  reports: "Session & progress reports",
  assignments: "New assignments",
  weekly_progress: "Weekly progress summary",
  billing: "Billing & payment updates",
  school_notices: "School notices",
};

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer border-b border-line last:border-0">
      <span className="t-body text-ink">{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-white shadow-lg text-[13px] font-semibold">
      <Check size={15} /> {msg}
    </div>
  );
}

export default function ParentSettingsPage() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("profile");
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="Account settings" subtitle="Manage your profile, children, notifications and billing." />
          <div className="mb-5"><Tabs items={TABS} active={tab} onChange={setTab} /></div>

          {tab === "profile" && <ProfileTab flash={flash} />}
          {tab === "children" && <ChildrenTab flash={flash} />}
          {tab === "notifications" && <NotificationsTab flash={flash} />}
          {tab === "account" && <AccountTab flash={flash} onSignedOut={logout} />}
          {tab === "privacy" && <PrivacyTab flash={flash} />}
          {tab === "billing" && <BillingTab />}
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}

/* ── Profile ───────────────────────────────────────────────────────────── */
function ProfileTab({ flash }: { flash: (m: string) => void }) {
  const [p, setP] = useState<ParentProfile | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { parentSettingsApi.getProfile().then(setP).catch(() => setP(null)); }, []);
  if (!p) return <Spinner />;
  const save = async () => {
    setSaving(true);
    try {
      const updated = await parentSettingsApi.updateProfile({ name: p.name, phone: p.phone ?? "", timezone: p.timezone, language: p.language, default_child_credits: p.default_child_credits });
      setP(updated); flash("Profile saved");
    } finally { setSaving(false); }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Your details" subtitle="Used for contact and session scheduling." />
      <CardBody className="pt-0 flex flex-col gap-4">
        <FormField label="Full name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></FormField>
        <FormField label="Email" hint="Contact support to change your sign-in email.">
          <Input value={p.email} disabled />
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Phone"><Input value={p.phone ?? ""} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="Optional" /></FormField>
          <FormField label="Timezone"><Input value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} /></FormField>
        </div>
        <FormField label="Default credits per child" hint="Applied when you add or link a child.">
          <div className="flex flex-wrap gap-2">
            {[50, 100, 200, 500, 1000].map((n) => (
              <button key={n} type="button" onClick={() => setP({ ...p, default_child_credits: n })} aria-pressed={p.default_child_credits === n}
                className={`px-3 py-1.5 rounded-full border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${p.default_child_credits === n ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
                {n}
              </button>
            ))}
          </div>
        </FormField>
        <div><Button onClick={save} loading={saving}>Save changes</Button></div>
      </CardBody>
    </Card>
  );
}

/* ── Children ──────────────────────────────────────────────────────────── */
function ChildrenTab({ flash }: { flash: (m: string) => void }) {
  const [children, setChildren] = useState<ChildSummary[] | null>(null);
  const [mode, setMode] = useState<"none" | "add" | "link">("none");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await parentSettingsApi.getChildren(); setChildren(r.children);
  }, []);
  useEffect(() => { load(); }, [load]);

  const addChild = async () => {
    setBusy(true); setError(null);
    try {
      await parentSettingsApi.addChild(form);
      setForm({ name: "", email: "", password: "" }); setMode("none"); await load(); flash("Child account created");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to add child"); } finally { setBusy(false); }
  };
  const linkChild = async () => {
    setBusy(true); setError(null);
    try {
      const r = await parentSettingsApi.linkChild(code);
      setCode(""); setMode("none"); await load(); flash(r.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to link child"); } finally { setBusy(false); }
  };
  const unlink = async (c: ChildSummary) => {
    if (!window.confirm(`Unlink ${c.name}? You'll no longer see their progress. Their account is not deleted.`)) return;
    await parentSettingsApi.unlinkChild(c.id); await load(); flash(`Unlinked ${c.name}`);
  };

  if (!children) return <Spinner />;
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex gap-2">
        <Button size="sm" leftIcon={<Plus size={15} />} onClick={() => { setMode(mode === "add" ? "none" : "add"); setError(null); }}>Add a child</Button>
        <Button size="sm" variant="secondary" leftIcon={<LinkIcon size={15} />} onClick={() => { setMode(mode === "link" ? "none" : "link"); setError(null); }}>Link with a code</Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {mode === "add" && (
        <Card><CardBody className="flex flex-col gap-3">
          <div className="t-card-title">Create a linked child account</div>
          <FormField label="Child's name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
            <FormField label="Temporary password" hint="At least 8 characters."><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></FormField>
          </div>
          <div><Button onClick={addChild} loading={busy} disabled={!form.name || !form.email || form.password.length < 8}>Create & link</Button></div>
        </CardBody></Card>
      )}

      {mode === "link" && (
        <Card><CardBody className="flex flex-col gap-3">
          <div className="t-card-title">Link an existing child</div>
          <p className="t-helper">Ask your child to generate an invite code from their account, then enter it below. Codes are single-use and expire after 3 days.</p>
          <div className="flex gap-2 items-end">
            <FormField label="Invite code" className="flex-1"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. DMBN85QH" /></FormField>
            <Button onClick={linkChild} loading={busy} disabled={code.length < 4}>Link</Button>
          </div>
        </CardBody></Card>
      )}

      {children.length === 0 ? (
        <EmptyState icon={<Users size={36} />} title="No children linked yet" description="Add a child account or link one with an invite code." />
      ) : children.map((c) => (
        <Card key={c.id}>
          <CardBody className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-brand-light text-brand flex items-center justify-center font-bold text-lg shrink-0">
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink truncate">{c.name}</span>
                {!c.is_active && <Badge tone="warning">Inactive</Badge>}
              </div>
              <div className="t-helper truncate">{c.email}</div>
              <div className="t-helper mt-0.5">
                {c.key_stage ? `${c.key_stage}` : "Key stage not set"}{c.year_group ? ` · ${c.year_group}` : ""} · {c.preferences_summary}
              </div>
            </div>
            <Button size="sm" variant="ghost" leftIcon={<Trash2 size={15} />} onClick={() => unlink(c)}>Unlink</Button>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

/* ── Notifications ─────────────────────────────────────────────────────── */
function NotificationsTab({ flash }: { flash: (m: string) => void }) {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { parentSettingsApi.getNotifications().then((r) => setPrefs(r.prefs)).catch(() => setPrefs({})); }, []);
  if (!prefs) return <Spinner />;
  const save = async () => {
    setSaving(true);
    try { const r = await parentSettingsApi.updateNotifications(prefs); setPrefs(r.prefs); flash("Notification preferences saved"); }
    finally { setSaving(false); }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Email notifications" subtitle="Choose what we email you about." />
      <CardBody className="pt-0">
        <div className="mb-4">
          {Object.keys(NOTIFICATION_LABELS).map((k) => (
            <ToggleRow key={k} label={NOTIFICATION_LABELS[k]} checked={prefs[k] ?? true} onChange={(v) => setPrefs({ ...prefs, [k]: v })} />
          ))}
        </div>
        <Button onClick={save} loading={saving}>Save preferences</Button>
      </CardBody>
    </Card>
  );
}

/* ── Account / security ────────────────────────────────────────────────── */
function AccountTab({ flash, onSignedOut }: { flash: (m: string) => void; onSignedOut: () => void }) {
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const changePw = async () => {
    setError(null);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("New passwords don't match.");
    setBusy(true);
    try {
      await parentSettingsApi.changePassword(cur, next);
      flash("Password updated — signing you out");
      window.setTimeout(onSignedOut, 1200);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to change password"); } finally { setBusy(false); }
  };
  const logoutAll = async () => {
    if (!window.confirm("Sign out of all devices? You'll need to sign in again.")) return;
    await parentSettingsApi.logoutAll();
    onSignedOut();
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Card>
        <CardHeader title="Change password" />
        <CardBody className="pt-0 flex flex-col gap-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></FormField>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="New password"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></FormField>
            <FormField label="Confirm new password"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></FormField>
          </div>
          <div><Button onClick={changePw} loading={busy} disabled={!cur || !next}>Update password</Button></div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sessions" subtitle="Sign out everywhere if you've used a shared device." />
        <CardBody className="pt-0">
          <Button variant="outline" leftIcon={<Lock size={15} />} onClick={logoutAll}>Sign out of all devices</Button>
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Privacy ───────────────────────────────────────────────────────────── */
function PrivacyTab({ flash }: { flash: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const request = async (type: "export" | "deletion") => {
    setBusy(type);
    try { await legalApi.createDataRequest(type); flash(type === "export" ? "Data export requested" : "Deletion request submitted"); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Alert tone="info" title="Your family's data">
        You control your data and your children's. Requests are handled by our team in line with UK GDPR and the Children's Code.
      </Alert>
      <Card>
        <CardHeader title="Data requests" />
        <CardBody className="pt-0 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div><div className="t-card-title">Export my data</div><div className="t-helper">Receive a copy of your account and your children's learning data.</div></div>
            <Button variant="secondary" size="sm" loading={busy === "export"} onClick={() => request("export")}>Request export</Button>
          </div>
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
            <div><div className="t-card-title">Delete my account</div><div className="t-helper">Request deletion of your account and linked child data.</div></div>
            <Button variant="danger" size="sm" loading={busy === "deletion"} onClick={() => request("deletion")}>Request deletion</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Billing (read-only summary) ───────────────────────────────────────── */
function BillingTab() {
  const [b, setB] = useState<ParentBilling | null>(null);
  useEffect(() => { parentSettingsApi.getBilling().then(setB).catch(() => setB(null)); }, []);
  if (!b) return <Spinner />;
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Card><CardBody>
          <div className="t-eyebrow">Credit balance</div>
          <div className="t-kpi mt-1">{b.credits.toFixed(0)}</div>
        </CardBody></Card>
        <Card><CardBody>
          <div className="t-eyebrow">Plan</div>
          {b.subscription ? (
            <>
              <div className="t-card-title mt-1">{b.subscription.plan_name} <Badge tone={b.subscription.status === "active" ? "success" : "neutral"}>{b.subscription.status}</Badge></div>
              <div className="t-helper mt-0.5">£{b.subscription.price.toFixed(2)}{b.subscription.renewal_date ? ` · renews ${new Date(b.subscription.renewal_date).toLocaleDateString()}` : ""}</div>
            </>
          ) : <div className="t-helper mt-1">No active subscription. Pay-as-you-go credits.</div>}
        </CardBody></Card>
      </div>

      <Alert tone="info" title="Payment methods">
        <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-brand shrink-0" />
          Card details are handled securely by our payment provider and never stored on our servers. Manage cards & subscriptions from the billing portal.</span>
      </Alert>

      <Card>
        <CardHeader title="Recent transactions" />
        <CardBody className="pt-0">
          {b.transactions.length === 0 ? (
            <EmptyState icon={<CreditCard size={32} />} title="No transactions yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left t-eyebrow border-b border-line">
                  <th className="py-2">Date</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {b.transactions.map((t, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-2 text-ink-muted whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
                      <td className="text-ink">{t.description || t.type}</td>
                      <td className={`text-right font-semibold ${t.amount >= 0 ? "text-success" : "text-ink"}`}>{t.amount >= 0 ? "+" : ""}{t.amount.toFixed(0)}</td>
                      <td className="text-right text-ink-muted">{t.balance_after.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
