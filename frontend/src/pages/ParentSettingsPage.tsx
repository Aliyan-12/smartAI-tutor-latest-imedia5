import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Users, Bell, Shield, Save, LogOut, Eye, EyeOff, ChevronRight } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { settingsApi, parentApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

type Tab = "profile" | "children" | "notifications" | "account";

interface LinkedStudent {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
}

export default function ParentSettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Profile tab
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState("");

  // Children tab
  const [children, setChildren] = useState<LinkedStudent[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);

  // Notifications tab
  const [notifPrefs, setNotifPrefs] = useState({
    session_reminders: true,
    session_reports_emailed: true,
    assignment_due_reminders: true,
    weekly_progress_summary: false,
  });

  // Account tab — password
  const [currPw, setCurrPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrPw, setShowCurrPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "children" && children.length === 0) {
      setChildrenLoading(true);
      parentApi
        .getStudents()
        .then((data: unknown) => {
          const list = Array.isArray(data) ? data : (data as { students?: LinkedStudent[] }).students ?? [];
          setChildren(list as LinkedStudent[]);
        })
        .catch(() => setChildren([]))
        .finally(() => setChildrenLoading(false));
    }
  }, [activeTab]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await settingsApi.updateProfile({ name });
      showToast("Profile updated!");
    } catch {
      showToast("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  const saveNotifications = async () => {
    setSaving(true);
    try {
      await settingsApi.updateNotifications(notifPrefs);
      showToast("Notification settings saved!");
    } catch {
      showToast("Failed to save notifications.");
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    setPwError(null);
    if (newPw.length < 6) {
      setPwError("New password must be at least 6 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await settingsApi.changePassword({ current_password: currPw, new_password: newPw });
      showToast("Password changed successfully!");
      setCurrPw("");
      setNewPw("");
      setConfirmPw("");
    } catch {
      setPwError("Incorrect current password.");
    } finally {
      setSaving(false);
    }
  };

  const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "profile",       icon: <User size={15} />,    label: "Profile" },
    { id: "children",      icon: <Users size={15} />,   label: "Children" },
    { id: "notifications", icon: <Bell size={15} />,    label: "Notifications" },
    { id: "account",       icon: <Shield size={15} />,  label: "Account" },
  ];

  const notifItems = [
    { id: "session_reminders",        label: "Session reminders",          sub: "Get reminded before your child's upcoming AI sessions" },
    { id: "session_reports_emailed",  label: "Session reports emailed",    sub: "Receive a detailed report after each AI tutoring session" },
    { id: "assignment_due_reminders", label: "Assignment due reminders",   sub: "Alerts when your child has an assignment due soon" },
    { id: "weekly_progress_summary",  label: "Weekly progress summary",    sub: "A weekly email with your child's learning progress" },
  ] as const;

  return (
    <>
      <style>{`
        .ps-page { display: flex; height: 100vh; background: #f5f5f0; }
        .ps-main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .ps-header { padding: 32px 40px 0; }
        .ps-header h1 { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
        .ps-header p { font-size: 14px; color: #64748b; margin: 0; }
        .ps-tabs {
          display: flex; gap: 2px; padding: 20px 40px 0;
          border-bottom: 2px solid #e2e8f0; overflow-x: auto;
        }
        .ps-tab {
          display: flex; align-items: center; gap: 6px; padding: 10px 16px;
          font-size: 13px; font-weight: 600; cursor: pointer; color: #64748b;
          border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap;
          background: none; border-top: none; border-left: none; border-right: none;
          transition: color .15s, border-color .15s;
        }
        .ps-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }
        .ps-tab:hover:not(.active) { color: #374151; }
        .ps-body { flex: 1; padding: 28px 40px; max-width: 860px; }
        .ps-card {
          background: white; border: 1.5px solid #e2e8f0; border-radius: 12px;
          padding: 24px; margin-bottom: 16px;
        }
        .ps-card-title {
          font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 18px;
          display: flex; align-items: center; gap: 8px;
        }
        .ps-avatar {
          width: 72px; height: 72px; border-radius: 50%;
          background: linear-gradient(135deg, #1a73e8, #0d47a1);
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; font-weight: 800; color: white; margin-bottom: 16px;
        }
        .ps-label { font-size: 13px; font-weight: 600; color: #374151; display: block; margin-bottom: 4px; }
        .ps-input {
          width: 100%; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 14px; color: #0f172a; outline: none; transition: border-color .15s;
          margin-bottom: 14px; box-sizing: border-box;
        }
        .ps-input:focus { border-color: #1a73e8; }
        .ps-input:read-only { background: #f8fafc; color: #64748b; cursor: default; }
        .ps-save-btn {
          padding: 10px 24px; background: #1a73e8; color: white; border: none;
          border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer;
          transition: background .15s; margin-top: 4px;
        }
        .ps-save-btn:hover { background: #1557b0; }
        .ps-save-btn:disabled { background: #93c5fd; cursor: default; }
        .ps-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0; border-bottom: 1px solid #f1f5f9;
        }
        .ps-row:last-child { border-bottom: none; padding-bottom: 0; }
        .ps-row-label { font-size: 14px; font-weight: 600; color: #0f172a; }
        .ps-row-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
        .ps-toggle { position: relative; width: 44px; height: 24px; cursor: pointer; flex-shrink: 0; }
        .ps-toggle input { opacity: 0; width: 0; height: 0; }
        .ps-toggle-slider {
          position: absolute; inset: 0; background: #cbd5e1; border-radius: 999px; transition: .2s;
        }
        .ps-toggle-slider:before {
          content: ""; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px;
          background: white; border-radius: 50%; transition: .2s;
        }
        .ps-toggle input:checked + .ps-toggle-slider { background: #1a73e8; }
        .ps-toggle input:checked + .ps-toggle-slider:before { transform: translateX(20px); }
        .ps-child-item {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 0; border-bottom: 1px solid #f1f5f9;
        }
        .ps-child-item:last-child { border-bottom: none; }
        .ps-child-avatar {
          width: 42px; height: 42px; border-radius: 50%;
          background: linear-gradient(135deg, #1a73e8, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          font-size: 17px; font-weight: 800; color: white; flex-shrink: 0;
        }
        .ps-child-name { font-size: 14px; font-weight: 700; color: #0f172a; }
        .ps-child-email { font-size: 12px; color: #64748b; margin-top: 2px; }
        .ps-badge {
          padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
          margin-left: auto; flex-shrink: 0;
        }
        .ps-badge-active { background: #dcfce7; color: #16a34a; }
        .ps-badge-inactive { background: #fee2e2; color: #dc2626; }
        .ps-manage-btn {
          display: flex; align-items: center; gap: 6px; margin-top: 18px;
          padding: 10px 16px; background: #eff6ff; color: #1a73e8; border: 1.5px solid #bfdbfe;
          border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
          transition: background .15s; width: fit-content;
        }
        .ps-manage-btn:hover { background: #dbeafe; }
        .ps-info-box {
          background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 10px;
          padding: 14px 16px; margin-top: 14px; font-size: 13px; color: #0c4a6e; line-height: 1.5;
        }
        .ps-info-box strong { font-weight: 700; }
        .ps-pw-wrap { position: relative; margin-bottom: 12px; }
        .ps-pw-eye {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          cursor: pointer; color: #94a3b8; background: none; border: none; padding: 0;
          display: flex; align-items: center;
        }
        .ps-pw-input {
          width: 100%; padding: 10px 40px 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 14px; color: #0f172a; outline: none; transition: border-color .15s; box-sizing: border-box;
        }
        .ps-pw-input:focus { border-color: #1a73e8; }
        .ps-error { color: #dc2626; font-size: 13px; margin: 0 0 12px; font-weight: 600; }
        .ps-danger-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 10px 20px; background: #fef2f2; color: #dc2626;
          border: 1.5px solid #fecaca; border-radius: 8px; font-size: 14px; font-weight: 700;
          cursor: pointer; transition: background .15s;
        }
        .ps-danger-btn:hover { background: #fee2e2; }
        .ps-toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: #1e293b; color: white; padding: 10px 20px; border-radius: 8px;
          font-size: 13px; font-weight: 600; z-index: 9999; white-space: nowrap;
        }
        .ps-spinner {
          display: flex; align-items: center; justify-content: center;
          padding: 32px 0; color: #94a3b8; font-size: 14px;
        }
        .ps-empty {
          text-align: center; padding: 32px 0; color: #94a3b8; font-size: 14px;
        }
        .ps-section-label {
          font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
          letter-spacing: 0.08em; margin: 0 0 10px;
        }
      `}</style>

      <div className="ps-page">
        <Sidebar />
        <div className="ps-main">
          <div className="ps-header">
            <h1>Settings</h1>
            <p>Manage your account, linked children, and notification preferences.</p>
          </div>

          <div className="ps-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`ps-tab${activeTab === t.id ? " active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div className="ps-body">
            {/* ── PROFILE ── */}
            {activeTab === "profile" && (
              <div className="ps-card">
                <p className="ps-card-title"><User size={16} /> Profile</p>
                <div className="ps-avatar">
                  {(name || user?.name || "?").charAt(0).toUpperCase()}
                </div>

                <label className="ps-label">Full Name</label>
                <input
                  className="ps-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                />

                <label className="ps-label">Email Address</label>
                <input
                  className="ps-input"
                  value={user?.email ?? ""}
                  readOnly
                  placeholder="Email address"
                />

                <label className="ps-label">Phone Number (optional)</label>
                <input
                  className="ps-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 07700 900000"
                  type="tel"
                />

                <button className="ps-save-btn" onClick={saveProfile} disabled={saving}>
                  <Save size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            )}

            {/* ── CHILDREN ── */}
            {activeTab === "children" && (
              <div className="ps-card">
                <p className="ps-card-title"><Users size={16} /> Linked Children</p>

                {childrenLoading ? (
                  <div className="ps-spinner">Loading children...</div>
                ) : children.length === 0 ? (
                  <div className="ps-empty">No linked children found.</div>
                ) : (
                  children.map((child) => (
                    <div key={child.id} className="ps-child-item">
                      <div className="ps-child-avatar">
                        {child.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ps-child-name">{child.name}</div>
                        <div className="ps-child-email">{child.email}</div>
                      </div>
                      <span className={`ps-badge ${child.is_active ? "ps-badge-active" : "ps-badge-inactive"}`}>
                        {child.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  ))
                )}

                <button className="ps-manage-btn" onClick={() => navigate("/parent/students")}>
                  <Users size={14} /> Manage Children <ChevronRight size={14} />
                </button>

                <div className="ps-info-box">
                  <strong>Need to add or remove a child?</strong><br />
                  To link or unlink a child account, please contact your school administrator. They can generate an invite code to link your child's account to your parent profile.
                </div>
              </div>
            )}

            {/* ── NOTIFICATIONS ── */}
            {activeTab === "notifications" && (
              <div className="ps-card">
                <p className="ps-card-title"><Bell size={16} /> Notifications</p>
                <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
                  Choose which notifications you receive about your child's learning activity.
                </p>

                {notifItems.map((n) => (
                  <div key={n.id} className="ps-row">
                    <div style={{ flex: 1, paddingRight: 16 }}>
                      <div className="ps-row-label">{n.label}</div>
                      <div className="ps-row-sub">{n.sub}</div>
                    </div>
                    <label className="ps-toggle">
                      <input
                        type="checkbox"
                        checked={notifPrefs[n.id]}
                        onChange={(e) =>
                          setNotifPrefs({ ...notifPrefs, [n.id]: e.target.checked })
                        }
                      />
                      <span className="ps-toggle-slider" />
                    </label>
                  </div>
                ))}

                <div style={{ marginTop: 20 }}>
                  <button className="ps-save-btn" onClick={saveNotifications} disabled={saving}>
                    <Save size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            )}

            {/* ── ACCOUNT ── */}
            {activeTab === "account" && (
              <>
                <div className="ps-card">
                  <p className="ps-card-title"><Shield size={16} /> Change Password</p>
                  <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 18px" }}>
                    Update your account password. We recommend using a strong, unique password.
                  </p>

                  <p className="ps-section-label">Current Password</p>
                  <div className="ps-pw-wrap">
                    <input
                      className="ps-pw-input"
                      type={showCurrPw ? "text" : "password"}
                      value={currPw}
                      onChange={(e) => setCurrPw(e.target.value)}
                      placeholder="Enter current password"
                    />
                    <button className="ps-pw-eye" onClick={() => setShowCurrPw((v) => !v)}>
                      {showCurrPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  <p className="ps-section-label">New Password</p>
                  <div className="ps-pw-wrap">
                    <input
                      className="ps-pw-input"
                      type={showNewPw ? "text" : "password"}
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="New password (min 6 characters)"
                    />
                    <button className="ps-pw-eye" onClick={() => setShowNewPw((v) => !v)}>
                      {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  <p className="ps-section-label">Confirm New Password</p>
                  <div className="ps-pw-wrap">
                    <input
                      className="ps-pw-input"
                      type={showConfirmPw ? "text" : "password"}
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      placeholder="Confirm new password"
                    />
                    <button className="ps-pw-eye" onClick={() => setShowConfirmPw((v) => !v)}>
                      {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {pwError && <p className="ps-error">{pwError}</p>}

                  <button
                    className="ps-save-btn"
                    onClick={savePassword}
                    disabled={saving || !currPw || !newPw || !confirmPw}
                  >
                    {saving ? "Updating..." : "Update Password"}
                  </button>
                </div>

                <div className="ps-card" style={{ border: "1.5px solid #fecaca" }}>
                  <button className="ps-danger-btn" onClick={logout}>
                    <LogOut size={15} /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="ps-toast">{toast}</div>}
    </>
  );
}
