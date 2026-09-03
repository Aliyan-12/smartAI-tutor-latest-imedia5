import { useEffect, useState } from "react";
import { Lock, Check, ShieldCheck } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import {
  teacherSettingsApi, legalApi, schoolBillingApi, curriculumApi, type TeacherClassSettings,
  type Offering, type TopupRequest,
} from "../services/api";
import {
  PageHeader, Card, CardBody, CardHeader, Button, Badge, Alert, Spinner,
  Input, FormField, Select, Switch, Tabs,
} from "../components/ui";

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "class", label: "Class defaults" },
  { key: "teaching", label: "Teaching" },
  { key: "notifications", label: "Notifications" },
  { key: "account", label: "Account" },
  { key: "privacy", label: "Privacy" },
];
const KEY_STAGES = ["KS1", "KS2", "KS3", "KS4", "KS5"];
const SUBJECTS = ["Maths", "English", "Science", "Biology", "Chemistry", "Physics", "History", "Geography", "Computer Science", "French", "Spanish"];
const APPROACHES = [
  { key: "balanced", label: "Balanced" },
  { key: "exam_focused", label: "Exam-focused" },
  { key: "conceptual", label: "Conceptual understanding" },
  { key: "practice_heavy", label: "Practice-heavy" },
  { key: "socratic", label: "Socratic / questioning" },
];
const REPORT_VIS = [
  { key: "parents_and_students", label: "Parents & students" },
  { key: "parents_only", label: "Parents only" },
  { key: "school_only", label: "School staff only" },
];
const NOTE_LABELS: Record<string, string> = {
  new_booking: "New session booking",
  report_ready: "Session report ready",
  assignment_submission: "Assignment submission",
  weekly_digest: "Weekly activity digest",
  parent_communication: "Parent messages",
  org_notices: "School / organisation notices",
};
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];

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
  return <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-white shadow-lg text-[13px] font-semibold"><Check size={15} /> {msg}</div>;
}

export default function TeacherSettingsPage() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("profile");
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); };
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="Teacher settings" subtitle="Your profile, classroom defaults and account." />
          <div className="mb-5"><Tabs items={TABS} active={tab} onChange={setTab} /></div>
          {tab === "profile" && <ProfileTab flash={flash} />}
          {(tab === "class" || tab === "teaching") && <ClassTab flash={flash} mode={tab} />}
          {tab === "notifications" && <NotificationsTab flash={flash} />}
          {tab === "account" && <AccountTab flash={flash} onSignedOut={logout} />}
          {tab === "privacy" && <PrivacyTab flash={flash} />}
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}

function ProfileTab({ flash }: { flash: (m: string) => void }) {
  const [p, setP] = useState<{ name: string; email: string; phone: string | null; timezone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { teacherSettingsApi.getProfile().then(setP).catch(() => setP(null)); }, []);
  if (!p) return <Spinner />;
  const save = async () => {
    setSaving(true);
    try { await teacherSettingsApi.updateProfile({ name: p.name, phone: p.phone ?? "", timezone: p.timezone }); flash("Profile saved"); }
    finally { setSaving(false); }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Your details" />
      <CardBody className="pt-0 flex flex-col gap-4">
        <FormField label="Full name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></FormField>
        <FormField label="Email" hint="Contact your school admin to change your sign-in email."><Input value={p.email} disabled /></FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Phone"><Input value={p.phone ?? ""} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="Optional" /></FormField>
          <FormField label="Timezone"><Input value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} /></FormField>
        </div>
        <div><Button onClick={save} loading={saving}>Save changes</Button></div>
      </CardBody>
    </Card>
  );
}

function ClassTab({ flash, mode }: { flash: (m: string) => void; mode: string }) {
  const [c, setC] = useState<TeacherClassSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [hubSubjects, setHubSubjects] = useState<string[]>([]);
  useEffect(() => { teacherSettingsApi.getClassSettings().then(setC).catch(() => setC(null)); }, []);
  useEffect(() => { curriculumApi.getSubjects().then((r) => setHubSubjects(r.subjects.map((s) => s.name))).catch(() => setHubSubjects([])); }, []);
  if (!c) return <Spinner />;
  const save = async () => {
    setSaving(true);
    try { const u = await teacherSettingsApi.updateClassSettings(c); setC(u); flash("Defaults saved — new bookings will use them"); }
    finally { setSaving(false); }
  };
  const toggleSubject = (s: string) =>
    setC({ ...c, default_subjects: c.default_subjects.includes(s) ? c.default_subjects.filter((x) => x !== s) : [...c.default_subjects, s] });
  const setAvail = (day: string, val: string) => {
    const windows = val.split(",").map((w) => w.trim()).filter(Boolean);
    setC({ ...c, availability: { ...c.availability, [day]: windows } });
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {mode === "class" ? (
        <>
        <Card>
          <CardHeader title="Session defaults" subtitle="Pre-filled when you book a new session." />
          <CardBody className="pt-0 flex flex-col gap-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Default session length">
                <div className="flex flex-wrap gap-2">
                  {[20, 40, 60, 90].map((m) => (
                    <button key={m} type="button" onClick={() => setC({ ...c, default_session_length: m })} aria-pressed={c.default_session_length === m}
                      className={`px-3 py-1.5 rounded-full border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${c.default_session_length === m ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
                      {m} min
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
            <FormField label="Default subjects" hint="Shown first in the booking form. Sourced from the Resource Hub curriculum.">
              <div className="flex flex-wrap gap-2">
                {(hubSubjects.length ? hubSubjects : SUBJECTS).map((s) => (
                  <button key={s} type="button" onClick={() => toggleSubject(s)} aria-pressed={c.default_subjects.includes(s)}
                    className={`px-3 py-1.5 rounded-full border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${c.default_subjects.includes(s) ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label="Report visibility">
              <Select value={c.report_visibility} onChange={(e) => setC({ ...c, report_visibility: e.target.value })}>
                {REPORT_VIS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Default credits for a new student" hint="Applied when you add a student.">
              <div className="flex flex-wrap gap-2">
                {[50, 100, 200, 500, 1000].map((n) => (
                  <button key={n} type="button" onClick={() => setC({ ...c, default_student_credits: n })} aria-pressed={c.default_student_credits === n}
                    className={`px-3 py-1.5 rounded-full border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${c.default_student_credits === n ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </FormField>
            <div><Button onClick={save} loading={saving}>Save defaults</Button></div>
          </CardBody>
        </Card>
        <RequestCreditsCard flash={flash} />
        </>
      ) : (
        <Card>
          <CardHeader title="Teaching preferences" subtitle="How you like lessons run, and when you're available." />
          <CardBody className="pt-0 flex flex-col gap-4">
            <FormField label="Preferred teaching approach">
              <Select value={c.teaching_approach} onChange={(e) => setC({ ...c, teaching_approach: e.target.value })}>
                {APPROACHES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Default lesson objectives" hint="Used as a starting objective for new lessons.">
              <textarea value={c.default_objectives} maxLength={2000} onChange={(e) => setC({ ...c, default_objectives: e.target.value })}
                placeholder="e.g. Build exam technique and confidence with past-paper questions."
                className="w-full min-h-[90px] p-3 rounded-lg border border-line bg-surface text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-y" />
            </FormField>
            <div>
              <div className="t-label mb-2">Availability (preferred windows)</div>
              <div className="flex flex-col gap-2">
                {DAYS.map(([key, label]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-10 t-label">{label}</span>
                    <Input value={(c.availability[key] ?? []).join(", ")} onChange={(e) => setAvail(key, e.target.value)} placeholder="e.g. 16:00-18:00, 19:00-20:00" className="flex-1" />
                  </div>
                ))}
              </div>
            </div>
            <div><Button onClick={save} loading={saving}>Save preferences</Button></div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function NotificationsTab({ flash }: { flash: (m: string) => void }) {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { teacherSettingsApi.getNotifications().then((r) => setPrefs(r.prefs)).catch(() => setPrefs({})); }, []);
  if (!prefs) return <Spinner />;
  const save = async () => {
    setSaving(true);
    try { const r = await teacherSettingsApi.updateNotifications(prefs); setPrefs(r.prefs); flash("Notification preferences saved"); }
    finally { setSaving(false); }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Email notifications" />
      <CardBody className="pt-0">
        <div className="mb-4">{Object.keys(NOTE_LABELS).map((k) => (
          <ToggleRow key={k} label={NOTE_LABELS[k]} checked={prefs[k] ?? true} onChange={(v) => setPrefs({ ...prefs, [k]: v })} />
        ))}</div>
        <Button onClick={save} loading={saving}>Save preferences</Button>
      </CardBody>
    </Card>
  );
}

function AccountTab({ flash, onSignedOut }: { flash: (m: string) => void; onSignedOut: () => void }) {
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<{ can_manage_assignments: boolean; billing_managed_by: string } | null>(null);
  useEffect(() => { teacherSettingsApi.getPolicy().then(setPolicy).catch(() => setPolicy(null)); }, []);

  const changePw = async () => {
    setError(null);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("New passwords don't match.");
    setBusy(true);
    try { await teacherSettingsApi.changePassword(cur, next); flash("Password updated — signing you out"); window.setTimeout(onSignedOut, 1200); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to change password"); } finally { setBusy(false); }
  };
  const logoutAll = async () => {
    if (!window.confirm("Sign out of all devices?")) return;
    await teacherSettingsApi.logoutAll(); onSignedOut();
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
            <FormField label="Confirm"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></FormField>
          </div>
          <div><Button onClick={changePw} loading={busy} disabled={!cur || !next}>Update password</Button></div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sessions" />
        <CardBody className="pt-0"><Button variant="outline" leftIcon={<Lock size={15} />} onClick={logoutAll}>Sign out of all devices</Button></CardBody>
      </Card>
      {policy && (
        <Card>
          <CardHeader title="School policy" subtitle="Set by your school — read-only." />
          <CardBody className="pt-0 flex flex-col gap-2">
            <div className="flex items-center justify-between"><span className="t-body">Manage assignments</span><Badge tone={policy.can_manage_assignments ? "success" : "neutral"}>{policy.can_manage_assignments ? "Allowed" : "Not allowed"}</Badge></div>
            <div className="flex items-center justify-between"><span className="t-body">Billing managed by</span><Badge tone="neutral">{policy.billing_managed_by === "school" ? "Your school" : "You"}</Badge></div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function PrivacyTab({ flash }: { flash: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const request = async (type: "export" | "deletion") => {
    setBusy(type);
    try { await legalApi.createDataRequest(type); flash(type === "export" ? "Data export requested" : "Deletion request submitted"); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Alert tone="info" title="Your data"><span className="flex items-center gap-2"><ShieldCheck size={15} className="text-brand shrink-0" /> Requests are handled by our team in line with UK GDPR.</span></Alert>
      <Card>
        <CardHeader title="Data requests" />
        <CardBody className="pt-0 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div><div className="t-card-title">Export my data</div><div className="t-helper">A copy of your account and activity.</div></div>
            <Button variant="secondary" size="sm" loading={busy === "export"} onClick={() => request("export")}>Request export</Button>
          </div>
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
            <div><div className="t-card-title">Delete my account</div><div className="t-helper">Request account deletion.</div></div>
            <Button variant="danger" size="sm" loading={busy === "deletion"} onClick={() => request("deletion")}>Request deletion</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Request a credit top-up (staff → school admin) ─────────────────────── */
function RequestCreditsCard({ flash }: { flash: (m: string) => void }) {
  const [packages, setPackages] = useState<Offering[]>([]);
  const [requests, setRequests] = useState<TopupRequest[]>([]);
  const [sel, setSel] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => schoolBillingApi.requests()
    .then((r) => { setPackages(r.packages || []); setRequests(r.requests || []); })
    .catch(() => {});
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!sel) { flash("Pick a top-up pack"); return; }
    setBusy(true);
    try { await schoolBillingApi.createRequest(sel, note.trim()); setSel(""); setNote(""); load(); flash("Request sent to your school admin"); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };
  const mine = requests.filter((r) => r.status === "pending");
  return (
    <Card>
      <CardHeader title="Request a credit top-up" subtitle="Ask your school admin to add credits — they approve and pay." />
      <CardBody className="pt-0 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {packages.map((p) => (
            <button key={p.slug} type="button" onClick={() => setSel(p.slug)} aria-pressed={sel === p.slug}
              className={`px-3 py-1.5 rounded-full border text-[13px] font-semibold transition-colors ${sel === p.slug ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
              {p.name} · {p.credits.toLocaleString()} cr
            </button>
          ))}
          {packages.length === 0 && <span className="t-helper">No top-up packs available yet.</span>}
        </div>
        <Input placeholder="Note (optional) — why you need the credits" value={note} onChange={(e) => setNote(e.target.value)} />
        <div><Button size="sm" loading={busy} onClick={submit}>Send request</Button></div>
        {mine.length > 0 && (
          <div className="pt-1">
            <div className="t-eyebrow mb-1">Your pending requests</div>
            {mine.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-line last:border-0 text-[13px]">
                <span className="text-ink">{r.package_slug} · {r.credits.toLocaleString()} cr</span>
                <Badge tone="warning">{r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
