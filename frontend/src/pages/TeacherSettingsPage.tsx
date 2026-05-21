import { useState } from "react";
import { User, BookOpen, Bell, Shield, Save, LogOut, Eye, EyeOff } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { settingsApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

type Tab = "profile" | "class" | "notifications" | "account";

const KEY_STAGES = ["KS1", "KS2", "KS3", "KS4", "KS5"];
const DURATIONS = [
  { value: 30,  label: "30 minutes" },
  { value: 45,  label: "45 minutes" },
  { value: 60,  label: "60 minutes" },
  { value: 90,  label: "90 minutes" },
];

export default function TeacherSettingsPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Profile
  const [name, setName] = useState(user?.name ?? "");
  const [specialism, setSpecialism] = useState("");
  const [specialisms, setSpecialisms] = useState<string[]>([]);

  // Class settings
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [defaultKeyStage, setDefaultKeyStage] = useState("KS4");

  // Notifications
  const [notifs, setNotifs] = useState({
    new_bookings: true,
    report_ready: true,
    assignments: false,
    weekly_digest: true,
  });

  // Password
  const [showPwForm, setShowPwForm] = useState(false);
  const [currPw, setCurrPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurr, setShowCurr] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    showToast("Profile updated!");
  };

  const handleSaveClass = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    showToast("Class settings saved!");
  };

  const handleSaveNotifs = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    showToast("Notification preferences saved!");
  };

  const handleChangePassword = async () => {
    setPwError("");
    if (!currPw || !newPw || !confirmPw) { setPwError("All fields are required."); return; }
    if (newPw.length < 6) { setPwError("New password must be at least 6 characters."); return; }
    if (newPw !== confirmPw) { setPwError("New passwords do not match."); return; }
    setSaving(true);
    try {
      await settingsApi.changePassword({ current_password: currPw, new_password: newPw });
      setCurrPw(""); setNewPw(""); setConfirmPw("");
      setShowPwForm(false);
      showToast("Password changed successfully!");
    } catch (e: unknown) {
      setPwError(e instanceof Error ? e.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  const addSpecialism = () => {
    const s = specialism.trim();
    if (s && !specialisms.includes(s)) setSpecialisms((p) => [...p, s]);
    setSpecialism("");
  };

  const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "profile",       icon: <User size={16} />,     label: "Profile" },
    { id: "class",         icon: <BookOpen size={16} />, label: "Class Settings" },
    { id: "notifications", icon: <Bell size={16} />,     label: "Notifications" },
    { id: "account",       icon: <Shield size={16} />,   label: "Account" },
  ];

  return (
    <>
      <style>{`
        .ts-page  { display: flex; height: 100vh; background: #f8fafc; font-family: "DM Sans", -apple-system, sans-serif; }
        .ts-main  { flex: 1; overflow-y: auto; }
        .ts-inner { padding: 32px 40px; max-width: 880px; }

        .ts-header { margin-bottom: 24px; }
        .ts-header h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
        .ts-header p  { font-size: 14px; color: #64748b; margin: 0; }

        .ts-layout { display: flex; gap: 20px; align-items: flex-start; }

        .ts-tabs {
          width: 200px; flex-shrink: 0;
          background: white; border: 1px solid #e2e8f0;
          border-radius: 12px; overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }
        .ts-tab {
          width: 100%; padding: 12px 16px;
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 600; color: #64748b;
          background: none; border: none; cursor: pointer;
          text-align: left; font-family: inherit;
          border-left: 3px solid transparent;
          transition: all .15s;
        }
        .ts-tab:hover   { background: #f8fafc; color: #374151; }
        .ts-tab.active  { background: #eff6ff; color: #1a73e8; border-left-color: #1a73e8; font-weight: 700; }

        .ts-panel {
          flex: 1;
          background: white; border: 1px solid #e2e8f0;
          border-radius: 12px; padding: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }
        .ts-section-title {
          font-size: 15px; font-weight: 700; color: #0f172a;
          margin: 0 0 18px; padding-bottom: 12px;
          border-bottom: 1px solid #f1f5f9;
          display: flex; align-items: center; gap: 8px;
        }

        .ts-avatar {
          width: 64px; height: 64px; border-radius: 50%;
          background: linear-gradient(135deg, #1a73e8, #1557b0);
          color: #fff; font-size: 26px; font-weight: 800;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 16px;
        }
        .ts-field { margin-bottom: 14px; }
        .ts-field label {
          display: block; font-size: 12px; font-weight: 700;
          color: #374151; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .3px;
        }
        .ts-field input, .ts-field select {
          width: 100%; padding: 10px 12px;
          border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 14px; color: #0f172a; background: #fff;
          font-family: inherit; transition: border-color .2s;
        }
        .ts-field input:focus, .ts-field select:focus {
          border-color: #1a73e8; outline: none;
          box-shadow: 0 0 0 3px rgba(26,115,232,.08);
        }
        .ts-field input:read-only { background: #f8fafc; color: #64748b; cursor: not-allowed; }

        .ts-tag-row { display: flex; gap: 8px; margin-bottom: 8px; }
        .ts-tag-input { flex: 1; }
        .ts-tag-add {
          padding: 10px 16px; background: #1a73e8; color: white;
          border: none; border-radius: 8px; font-size: 13px; font-weight: 700;
          cursor: pointer; white-space: nowrap; font-family: inherit;
        }
        .ts-tag-add:hover { background: #1557b0; }
        .ts-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
        .ts-chip {
          display: flex; align-items: center; gap: 6px;
          background: #eff6ff; border: 1px solid #bfdbfe;
          border-radius: 999px; padding: 4px 10px;
          font-size: 12px; font-weight: 600; color: #1e40af;
        }
        .ts-chip button {
          background: none; border: none; cursor: pointer;
          color: #64748b; font-size: 14px; line-height: 1; padding: 0;
        }
        .ts-chip button:hover { color: #dc2626; }

        .ts-info-box {
          background: #f8fafc; border: 1px solid #e2e8f0;
          border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;
          font-size: 13px; color: #475569; line-height: 1.5;
        }
        .ts-info-box strong { color: #0f172a; }

        .ts-duration-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-bottom: 14px; }
        .ts-dur-btn {
          padding: 10px 8px; border-radius: 8px; border: 1.5px solid #e2e8f0;
          font-size: 13px; font-weight: 600; color: #475569;
          background: white; cursor: pointer; text-align: center;
          transition: all .15s; font-family: inherit;
        }
        .ts-dur-btn:hover { border-color: #1a73e8; color: #1a73e8; }
        .ts-dur-btn.active { background: #1a73e8; color: white; border-color: #1a73e8; }

        .ts-ks-grid { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
        .ts-ks-btn {
          padding: 8px 16px; border-radius: 8px; border: 1.5px solid #e2e8f0;
          font-size: 13px; font-weight: 600; color: #475569;
          background: white; cursor: pointer; transition: all .15s; font-family: inherit;
        }
        .ts-ks-btn:hover { border-color: #1a73e8; color: #1a73e8; }
        .ts-ks-btn.active { background: #1a73e8; color: white; border-color: #1a73e8; }

        .ts-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 0; border-bottom: 1px solid #f1f5f9;
        }
        .ts-toggle-row:last-child { border-bottom: none; }
        .ts-toggle-lbl { font-size: 14px; font-weight: 600; color: #0f172a; }
        .ts-toggle-sub { font-size: 12px; color: #64748b; margin-top: 1px; }
        .ts-toggle {
          position: relative; width: 42px; height: 24px; flex-shrink: 0;
        }
        .ts-toggle input { opacity: 0; width: 0; height: 0; }
        .ts-slider {
          position: absolute; inset: 0; background: #e2e8f0;
          border-radius: 999px; cursor: pointer; transition: background .2s;
        }
        .ts-slider::before {
          content: ""; position: absolute;
          width: 18px; height: 18px; border-radius: 50%;
          background: white; top: 3px; left: 3px; transition: transform .2s;
          box-shadow: 0 1px 3px rgba(0,0,0,.2);
        }
        .ts-toggle input:checked + .ts-slider { background: #1a73e8; }
        .ts-toggle input:checked + .ts-slider::before { transform: translateX(18px); }

        .ts-save-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 20px; background: #1a73e8; color: white;
          border: none; border-radius: 9px; font-size: 14px; font-weight: 700;
          cursor: pointer; margin-top: 18px; font-family: inherit;
          transition: background .2s; box-shadow: 0 4px 12px rgba(26,115,232,.2);
        }
        .ts-save-btn:hover:not(:disabled) { background: #1557b0; }
        .ts-save-btn:disabled { opacity: .6; cursor: not-allowed; }

        .ts-pw-section {
          border: 1px solid #e2e8f0; border-radius: 10px;
          padding: 16px; margin-bottom: 16px;
        }
        .ts-pw-toggle {
          background: none; border: none; color: #1a73e8;
          font-size: 14px; font-weight: 600; cursor: pointer;
          font-family: inherit; padding: 0;
        }
        .ts-pw-toggle:hover { text-decoration: underline; }
        .ts-pw-inputs { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; }
        .ts-pw-field { position: relative; }
        .ts-pw-field input { padding-right: 40px; }
        .ts-pw-eye {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: #94a3b8;
        }
        .ts-error {
          background: #fef2f2; border: 1px solid #fecaca; color: #dc2626;
          border-radius: 7px; padding: 10px 12px; font-size: 13px; margin-top: 10px;
        }
        .ts-logout-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 20px; background: #fef2f2; color: #dc2626;
          border: 1px solid #fecaca; border-radius: 9px;
          font-size: 14px; font-weight: 700; cursor: pointer;
          margin-top: 12px; font-family: inherit; transition: background .2s;
        }
        .ts-logout-btn:hover { background: #fee2e2; }

        .ts-toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: #1e293b; color: white; padding: 10px 22px;
          border-radius: 8px; font-size: 13px; font-weight: 600;
          z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,.2);
          border: 1px solid rgba(255,255,255,.08); white-space: nowrap;
          animation: ts-fadein .2s ease;
        }
        @keyframes ts-fadein { from { opacity:0; transform: translateX(-50%) translateY(6px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
      `}</style>

      {toast && <div className="ts-toast">{toast}</div>}

      <div className="ts-page">
        <Sidebar />
        <div className="ts-main">
          <div className="ts-inner">
            <div className="ts-header">
              <h1>Settings</h1>
              <p>Manage your profile, class preferences, and account security.</p>
            </div>

            <div className="ts-layout">
              {/* Tab list */}
              <div className="ts-tabs">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={`ts-tab${activeTab === t.id ? " active" : ""}`}
                    onClick={() => setActiveTab(t.id)}
                  >
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>

              {/* Panel */}
              <div className="ts-panel">
                {/* ── Profile ── */}
                {activeTab === "profile" && (
                  <>
                    <div className="ts-section-title"><User size={15} /> My Profile</div>
                    <div className="ts-avatar">{(user?.name ?? "T").charAt(0).toUpperCase()}</div>

                    <div className="ts-field">
                      <label>Display Name</label>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                    </div>
                    <div className="ts-field">
                      <label>Email Address</label>
                      <input value={user?.email ?? ""} readOnly />
                    </div>
                    <div className="ts-field">
                      <label>School</label>
                      <input value="Greenfield Int. School" readOnly />
                    </div>
                    <div className="ts-field">
                      <label>Role</label>
                      <input value="Teacher" readOnly />
                    </div>

                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".3px" }}>
                      Subject Specialisms
                    </label>
                    {specialisms.length > 0 && (
                      <div className="ts-chips">
                        {specialisms.map((s) => (
                          <span key={s} className="ts-chip">
                            {s}
                            <button onClick={() => setSpecialisms((p) => p.filter((x) => x !== s))}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="ts-tag-row">
                      <input
                        className="ts-field ts-tag-input"
                        style={{ margin: 0, padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontFamily: "inherit" }}
                        value={specialism}
                        onChange={(e) => setSpecialism(e.target.value)}
                        placeholder="e.g. Mathematics, Physics"
                        onKeyDown={(e) => e.key === "Enter" && addSpecialism()}
                      />
                      <button className="ts-tag-add" onClick={addSpecialism}>+ Add</button>
                    </div>

                    <button className="ts-save-btn" onClick={handleSaveProfile} disabled={saving}>
                      <Save size={14} />{saving ? "Saving…" : "Save Changes"}
                    </button>
                  </>
                )}

                {/* ── Class Settings ── */}
                {activeTab === "class" && (
                  <>
                    <div className="ts-section-title"><BookOpen size={15} /> Class Preferences</div>

                    <div className="ts-info-box">
                      These settings will be pre-filled when you book new sessions, saving you time.
                      <br /><strong>School:</strong> Greenfield Int. School &nbsp;·&nbsp; <strong>Role:</strong> Teacher
                    </div>

                    <div className="ts-field">
                      <label>Default Session Duration</label>
                    </div>
                    <div className="ts-duration-grid">
                      {DURATIONS.map((d) => (
                        <button
                          key={d.value}
                          className={`ts-dur-btn${defaultDuration === d.value ? " active" : ""}`}
                          onClick={() => setDefaultDuration(d.value)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>

                    <div className="ts-field">
                      <label>Default Key Stage</label>
                    </div>
                    <div className="ts-ks-grid">
                      {KEY_STAGES.map((ks) => (
                        <button
                          key={ks}
                          className={`ts-ks-btn${defaultKeyStage === ks ? " active" : ""}`}
                          onClick={() => setDefaultKeyStage(ks)}
                        >
                          {ks}
                        </button>
                      ))}
                    </div>

                    <button className="ts-save-btn" onClick={handleSaveClass} disabled={saving}>
                      <Save size={14} />{saving ? "Saving…" : "Save Class Settings"}
                    </button>
                  </>
                )}

                {/* ── Notifications ── */}
                {activeTab === "notifications" && (
                  <>
                    <div className="ts-section-title"><Bell size={15} /> Notification Preferences</div>
                    {([
                      { key: "new_bookings" as const,  label: "New Session Bookings",         sub: "When a parent books a session" },
                      { key: "report_ready" as const,  label: "Session Report Ready",          sub: "When an AI report is generated" },
                      { key: "assignments" as const,   label: "Assignment Submissions",        sub: "When students submit assignments" },
                      { key: "weekly_digest" as const, label: "Weekly Activity Digest",        sub: "Summary email every Monday" },
                    ] as const).map(({ key, label, sub }) => (
                      <div key={key} className="ts-toggle-row">
                        <div>
                          <div className="ts-toggle-lbl">{label}</div>
                          <div className="ts-toggle-sub">{sub}</div>
                        </div>
                        <label className="ts-toggle">
                          <input
                            type="checkbox"
                            checked={notifs[key]}
                            onChange={(e) => setNotifs((p) => ({ ...p, [key]: e.target.checked }))}
                          />
                          <span className="ts-slider" />
                        </label>
                      </div>
                    ))}
                    <button className="ts-save-btn" onClick={handleSaveNotifs} disabled={saving}>
                      <Save size={14} />{saving ? "Saving…" : "Save Preferences"}
                    </button>
                  </>
                )}

                {/* ── Account ── */}
                {activeTab === "account" && (
                  <>
                    <div className="ts-section-title"><Shield size={15} /> Account Security</div>

                    <div className="ts-pw-section">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 2 }}>Change Password</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>Keep your account secure</div>
                        </div>
                        <button className="ts-pw-toggle" onClick={() => { setShowPwForm((v) => !v); setPwError(""); }}>
                          {showPwForm ? "Cancel" : "Change"}
                        </button>
                      </div>

                      {showPwForm && (
                        <div className="ts-pw-inputs">
                          {[
                            { label: "Current Password", val: currPw, set: setCurrPw, show: showCurr, toggle: () => setShowCurr((v) => !v) },
                            { label: "New Password",     val: newPw,  set: setNewPw,  show: showNew,  toggle: () => setShowNew((v) => !v) },
                            { label: "Confirm New Password", val: confirmPw, set: setConfirmPw, show: showNew, toggle: () => setShowNew((v) => !v) },
                          ].map(({ label, val, set, show, toggle }) => (
                            <div key={label} className="ts-field ts-pw-field" style={{ margin: 0 }}>
                              <label>{label}</label>
                              <div style={{ position: "relative" }}>
                                <input
                                  type={show ? "text" : "password"}
                                  value={val}
                                  onChange={(e) => set(e.target.value)}
                                  placeholder={label}
                                  style={{ paddingRight: 40 }}
                                />
                                <button type="button" className="ts-pw-eye" onClick={toggle}>
                                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                              </div>
                            </div>
                          ))}
                          {pwError && <div className="ts-error">{pwError}</div>}
                          <button className="ts-save-btn" style={{ marginTop: 4 }} onClick={handleChangePassword} disabled={saving}>
                            <Save size={14} />{saving ? "Updating…" : "Update Password"}
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ padding: "12px 0", borderTop: "1px solid #f1f5f9", marginTop: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>Sign Out</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Sign out of your teacher account on this device.</div>
                      <button className="ts-logout-btn" onClick={logout}>
                        <LogOut size={15} /> Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
