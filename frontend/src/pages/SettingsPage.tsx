import { useState, useEffect } from "react";
import { User, Sliders, BookOpen, Bell, Shield, Save, LogOut, Eye, EyeOff } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { settingsApi, curriculumApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { LearningPreferences } from "../types";

type Tab = "profile" | "preferences" | "learning" | "notifications" | "account";

// Friendly labels for the hub's key stage codes (options themselves come from the Resource Hub).
const KS_LABELS: Record<string, string> = {
  KS1: "KS1 — Years 1 & 2",
  KS2: "KS2 — Years 3 to 6",
  KS3: "KS3 — Years 7 to 9",
  KS4: "KS4 — Years 10 & 11 (GCSE)",
  KS5: "KS5 — Years 12 & 13 (A-Level)",
};
const LEARNING_STYLES = [
  { id: "visual",     icon: "👁", label: "Visual" },
  { id: "auditory",   icon: "👂", label: "Auditory" },
  { id: "read_write", icon: "📖", label: "Read / Write" },
  { id: "hands_on",  icon: "✋", label: "Hands-on" },
];
const PACES = [
  { id: "slower",    icon: "🐢", label: "Slower" },
  { id: "just_right",icon: "✅", label: "Just Right" },
  { id: "faster",    icon: "🚀", label: "Faster" },
];
const TEACH_PREFS = [
  { id: "step_by_step",       label: "Step-by-step explanations" },
  { id: "real_life_examples", label: "Real-life examples" },
  { id: "practice_as_we_go",  label: "Practice questions as we go" },
  { id: "short_summaries",    label: "Short summaries only" },
  { id: "analogies",          label: "Use of analogies and stories" },
];

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Profile
  const [name, setName] = useState(user?.name ?? "");
  const [yearGroup, setYearGroup] = useState("");
  const [keyStage, setKeyStage] = useState("");
  // Key stages + year groups sourced from the Resource Hub (not hardcoded).
  const [hubKeyStages, setHubKeyStages] = useState<string[]>([]);
  const [hubYears, setHubYears] = useState<string[]>([]);

  // Preferences (local only for now)
  const [voiceResponses, setVoiceResponses] = useState(true);
  const [textSize, setTextSize] = useState<"sm" | "md" | "lg">("md");
  const [darkMode, setDarkMode] = useState(false);

  // Learning prefs
  const [prefs, setPrefs] = useState<LearningPreferences | null>(null);
  const [learningStyles, setLearningStyles] = useState<string[]>([]);
  const [pace, setPace] = useState("just_right");
  const [teachPrefs, setTeachPrefs] = useState<Record<string, boolean>>({
    step_by_step: true, real_life_examples: true, practice_as_we_go: true,
    short_summaries: false, analogies: false,
  });
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [learningGoals, setLearningGoals] = useState("");

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState({
    assignment_reminders: true, session_reminders: true,
    messages: true, weekly_progress: false,
  });

  // Password change
  const [showPwForm, setShowPwForm] = useState(false);
  const [currPw, setCurrPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrPw, setShowCurrPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  useEffect(() => {
    settingsApi.getLearningPreferences().then((data) => {
      const d = data as LearningPreferences;
      setPrefs(d);
      setLearningStyles(d.learning_style ?? []);
      setPace(d.teaching_pace ?? "just_right");
      setTeachPrefs(d.teaching_preferences ?? teachPrefs);
      setInterests(d.interests ?? []);
      setLearningGoals(d.learning_goals ?? "");
      setYearGroup(d.year_group ?? "");
      setKeyStage(d.key_stage ?? "");
      setVoiceResponses(d.voice_responses ?? true);
      if (d.notification_prefs) {
        setNotifPrefs({ ...notifPrefs, ...d.notification_prefs });
      }
    }).catch(() => {});
  }, []);

  // Key stages from the Resource Hub.
  useEffect(() => {
    curriculumApi.getKeyStages()
      .then((d) => setHubKeyStages(d.keystages ?? []))
      .catch(() => {});
  }, []);

  // Year groups for the chosen key stage.
  useEffect(() => {
    if (!keyStage) { setHubYears([]); return; }
    curriculumApi.getYears(keyStage)
      .then((d) => setHubYears(d.years ?? []))
      .catch(() => setHubYears([]));
  }, [keyStage]);

  const handleKeyStageChange = (val: string) => {
    setKeyStage(val);
    setYearGroup("");  // year group depends on key stage
  };

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 2500);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      // Key Stage + Year Group are set at onboarding and are NOT editable here
      // (the dropdowns are locked) — only the name is updated from this form.
      await settingsApi.updateProfile({ name });
      showToast("Profile saved!");
    } catch { showToast("Failed to save profile."); }
    finally { setSaving(false); }
  };

  const saveLearning = async () => {
    setSaving(true);
    try {
      await settingsApi.updateLearningPreferences({
        learning_style: learningStyles, teaching_pace: pace,
        teaching_preferences: teachPrefs, interests, learning_goals: learningGoals,
        voice_responses: voiceResponses,
      });
      showToast("Learning preferences saved!");
    } catch { showToast("Failed to save preferences."); }
    finally { setSaving(false); }
  };

  const saveNotifications = async () => {
    setSaving(true);
    try {
      await settingsApi.updateNotifications(notifPrefs);
      showToast("Notification settings saved!");
    } catch { showToast("Failed to save notifications."); }
    finally { setSaving(false); }
  };

  const savePassword = async () => {
    if (newPw !== confirmPw) { showToast("Passwords do not match."); return; }
    if (newPw.length < 6) { showToast("New password must be at least 6 characters."); return; }
    setSaving(true);
    try {
      await settingsApi.changePassword({ current_password: currPw, new_password: newPw });
      showToast("Password changed!");
      setCurrPw(""); setNewPw(""); setConfirmPw(""); setShowPwForm(false);
    } catch { showToast("Incorrect current password."); }
    finally { setSaving(false); }
  };

  const toggleStyle = (id: string) =>
    setLearningStyles((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);

  const addInterest = () => {
    const v = interestInput.trim();
    if (v && !interests.includes(v)) setInterests([...interests, v]);
    setInterestInput("");
  };

  const personalisedSummary = () => {
    const lines: string[] = [];
    if (learningStyles.length) lines.push(`Explain concepts ${learningStyles.includes("visual") ? "visually" : "clearly"} with real-life scenarios.`);
    lines.push(`Go at a ${pace.replace("_", " ")} pace with ${teachPrefs.step_by_step ? "step-by-step" : "flexible"} teaching.`);
    if (interests.length) lines.push(`Include topics related to your interests: ${interests.slice(0, 3).join(", ")}.`);
    if (learningGoals) lines.push(`Focus on: ${learningGoals.slice(0, 60)}${learningGoals.length > 60 ? "..." : ""}.`);
    return lines;
  };

  const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "profile",       icon: <User size={15} />,    label: "Profile" },
    { id: "preferences",   icon: <Sliders size={15} />, label: "Preferences" },
    { id: "learning",      icon: <BookOpen size={15} />,label: "Learning Preferences" },
    { id: "notifications", icon: <Bell size={15} />,    label: "Notifications" },
    { id: "account",       icon: <Shield size={15} />,  label: "Account" },
  ];

  return (
    <>
      <style>{`
        .sett-page { display: flex; height: 100vh; background: #f8fafc; overflow: hidden; }
        .sett-main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
        .sett-body { flex: none; padding: 24px; max-width: 860px; }
        @media (max-width: 768px) {
          .sett-page { overflow-x: hidden; }
          .sett-main { overflow-x: hidden; }
          .sett-body { padding: 16px; max-width: 100%; }
          .sett-tabs { padding: 12px 16px 0; }
          .sett-hero { margin: 12px 12px 0; padding: 20px 18px; min-height: unset; }
          .sett-hero h1 { font-size: 20px; }
          .sett-hero-robot { height: 70px; }
          .sett-hero-right { display: none; }
        }

        /* Hero banner */
        .sett-hero {
          flex-shrink: 0;
          margin: 24px 24px 0;
          border-radius: 18px;
          background: linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #4338ca 75%, #6366f1 100%);
          padding: 28px 32px;
          display: flex; align-items: center; justify-content: space-between;
          overflow: hidden; position: relative; min-height: 110px;
        }
        .sett-hero::before {
          content: ""; position: absolute; inset: 0;
          background: radial-gradient(ellipse at 30% 50%, rgba(99,102,241,0.35) 0%, transparent 65%),
                      radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.25) 0%, transparent 55%);
          pointer-events: none;
        }
        .sett-hero-left { position: relative; z-index: 1; }
        .sett-hero-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2);
          border-radius: 999px; padding: 4px 12px; font-size: 11px; font-weight: 700;
          color: rgba(255,255,255,0.85); margin-bottom: 8px; backdrop-filter: blur(6px);
        }
        .sett-hero h1 {
          font-size: 24px; font-weight: 800; color: #fff;
          margin: 0 0 4px; line-height: 1.2;
        }
        .sett-hero p { font-size: 13px; color: rgba(199,210,254,0.85); margin: 0; }
        .sett-hero-avatar {
          width: 52px; height: 52px; border-radius: 50%;
          background: linear-gradient(135deg, #a5b4fc, #7c3aed);
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; font-weight: 800; color: white;
          border: 3px solid rgba(255,255,255,0.25);
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          margin-top: 10px;
        }
        .sett-hero-right {
          position: relative; z-index: 1;
          display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
        }
        .sett-hero-robot {
          height: 90px; width: auto; object-fit: contain;
          filter: drop-shadow(0 6px 20px rgba(0,0,0,0.4));
          pointer-events: none; flex-shrink: 0;
        }
        .sett-hero-stat-row {
          display: flex; gap: 8px;
        }
        .sett-hero-stat {
          background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
          border-radius: 10px; padding: 6px 12px; text-align: center; backdrop-filter: blur(6px);
        }
        .sett-hero-stat-val { font-size: 14px; font-weight: 800; color: #fff; line-height: 1; }
        .sett-hero-stat-lbl { font-size: 10px; color: rgba(199,210,254,0.75); margin-top: 2px; font-weight: 600; }

        .sett-tabs { display: flex; gap: 2px; padding: 16px 24px 0; border-bottom: 2px solid #e2e8f0; overflow-x: auto; flex-shrink: 0; }
        .sett-tab {
          display: flex; align-items: center; gap: 6px; padding: 10px 16px;
          font-size: 13px; font-weight: 600; cursor: pointer; color: #64748b;
          border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap;
          background: none; border-top: none; border-left: none; border-right: none;
          transition: color .15s, border-color .15s;
        }
        .sett-tab.active { color: #6366f1; border-bottom-color: #6366f1; }
        .sett-tab:hover:not(.active) { color: #374151; }
        /* .sett-body base rule is in the responsive block above */
        .sett-card {
          background: white; border: 1.5px solid #e2e8f0; border-radius: 14px;
          padding: 24px; margin-bottom: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          border-top: 3px solid #6366f1;
        }
        .sett-card-title {
          font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 18px;
          display: flex; align-items: center; gap: 8px;
          padding-bottom: 12px; border-bottom: 1px solid #f1f5f9;
        }
        .sett-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .sett-row:last-child { border-bottom: none; padding-bottom: 0; }
        .sett-row-label { font-size: 14px; font-weight: 600; color: #0f172a; }
        .sett-row-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
        .sett-input {
          width: 100%; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 14px; color: #0f172a; outline: none; transition: border-color .15s;
          margin-bottom: 12px;
        }
        .sett-input:focus { border-color: #6366f1; }
        .sett-select {
          padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 13px; color: #374151; background: white; cursor: pointer; outline: none;
        }
        .sett-toggle { position: relative; width: 44px; height: 24px; cursor: pointer; }
        .sett-toggle input { opacity: 0; width: 0; height: 0; }
        .sett-toggle-slider {
          position: absolute; inset: 0; background: #cbd5e1; border-radius: 999px; transition: .2s;
        }
        .sett-toggle-slider:before {
          content: ""; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px;
          background: white; border-radius: 50%; transition: .2s;
        }
        .sett-toggle input:checked + .sett-toggle-slider { background: #6366f1; }
        .sett-toggle input:checked + .sett-toggle-slider:before { transform: translateX(20px); }
        .sett-style-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 18px; }
        .sett-style-tile {
          display: flex; align-items: center; gap: 10px; padding: 12px 14px;
          border: 2px solid #e2e8f0; border-radius: 10px; cursor: pointer;
          font-size: 14px; font-weight: 600; color: #374151; transition: .15s;
          background: white;
        }
        .sett-style-tile.selected { border-color: #6366f1; background: #eef2ff; color: #4338ca; }
        .sett-pace-row { display: flex; gap: 10px; margin-bottom: 18px; }
        .sett-pace-btn {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 10px 14px; border: 2px solid #e2e8f0; border-radius: 10px;
          font-size: 13px; font-weight: 600; color: #374151; cursor: pointer;
          background: white; transition: .15s;
        }
        .sett-pace-btn.selected { border-color: #6366f1; background: #eef2ff; color: #4338ca; }
        .sett-check-label {
          display: flex; align-items: center; gap: 10px; padding: 10px 0;
          font-size: 14px; color: #374151; cursor: pointer; user-select: none;
          border-bottom: 1px solid #f8fafc;
        }
        .sett-check-label:last-child { border-bottom: none; }
        .sett-check-label input { width: 16px; height: 16px; accent-color: #6366f1; cursor: pointer; }
        .sett-tag-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
        .sett-tag {
          display: flex; align-items: center; gap: 5px; padding: 4px 10px;
          background: #eef2ff; color: #4338ca; border-radius: 999px; font-size: 12px; font-weight: 600;
          border: 1px solid #c7d2fe;
        }
        .sett-tag button { background: none; border: none; color: #6366f1; cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }
        .sett-tag-input { display: flex; gap: 8px; }
        .sett-tag-input input {
          flex: 1; padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 13px; outline: none; transition: border-color .15s;
        }
        .sett-tag-input input:focus { border-color: #6366f1; }
        .sett-tag-add {
          padding: 8px 14px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none;
          border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .sett-summary-box {
          background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 10px;
          padding: 16px; margin-top: 16px;
        }
        .sett-summary-box h4 { font-size: 13px; font-weight: 700; color: #0369a1; margin: 0 0 10px; }
        .sett-summary-box ul { margin: 0; padding-left: 18px; }
        .sett-summary-box li { font-size: 13px; color: #0c4a6e; margin-bottom: 4px; }
        .sett-text-size-row { display: flex; gap: 8px; }
        .sett-text-btn {
          width: 40px; height: 36px; border: 2px solid #e2e8f0; border-radius: 8px;
          background: white; cursor: pointer; font-weight: 700; color: #374151;
          display: flex; align-items: center; justify-content: center; transition: .15s;
        }
        .sett-text-btn.selected { border-color: #6366f1; background: #eef2ff; color: #4338ca; }
        .sett-save-btn {
          padding: 10px 24px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none;
          border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer;
          transition: opacity .15s; margin-top: 4px;
          box-shadow: 0 2px 8px rgba(99,102,241,0.35);
        }
        .sett-save-btn:hover { opacity: 0.88; }
        .sett-save-btn:disabled { opacity: 0.5; cursor: default; }
        .sett-danger-btn {
          padding: 10px 20px; background: #fef2f2; color: #dc2626; border: 1.5px solid #fecaca;
          border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; transition: .15s;
        }
        .sett-danger-btn:hover { background: #fee2e2; }
        .sett-pw-row { position: relative; margin-bottom: 12px; }
        .sett-pw-eye { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #94a3b8; }
        .sett-toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: #1e293b; color: white; padding: 10px 20px; border-radius: 8px;
          font-size: 13px; font-weight: 600; z-index: 9999;
        }
        .sett-avatar {
          width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          display: flex; align-items: center; justify-content: center; font-size: 28px;
          font-weight: 800; color: white; margin-bottom: 16px;
        }
      `}</style>

      <div className="sett-page">
        <Sidebar />
        <div className="sett-main">
          {/* Hero Banner */}
          <div className="sett-hero">
            <div className="sett-hero-left">
              <div className="sett-hero-badge">⚙️ Settings</div>
              <h1>Your Account</h1>
              <p>Personalise your learning experience</p>
              <div className="sett-hero-avatar">
                {(name || user?.name || "?").charAt(0).toUpperCase()}
              </div>
            </div>
            <div className="sett-hero-right">
              <img src="/images/robotAI.png" alt="Settings robot" className="sett-hero-robot" draggable={false} />
              <div className="sett-hero-stat-row">
                <div className="sett-hero-stat">
                  <div className="sett-hero-stat-val">5</div>
                  <div className="sett-hero-stat-lbl">Sections</div>
                </div>
                <div className="sett-hero-stat">
                  <div className="sett-hero-stat-val">{user?.name ? "✓" : "!"}</div>
                  <div className="sett-hero-stat-lbl">Profile</div>
                </div>
              </div>
            </div>
          </div>

          <div className="sett-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`sett-tab${activeTab === t.id ? " active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div className="sett-body">
            {/* ── PROFILE ── */}
            {activeTab === "profile" && (
              <div className="sett-card">
                <p className="sett-card-title"><User size={16} /> Profile</p>
                <div className="sett-avatar">{(name || user?.name || "?").charAt(0).toUpperCase()}</div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Full Name</label>
                <input className="sett-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                  Key Stage <span style={{ fontWeight: 400, color: "#94a3b8" }}>🔒</span>
                </label>
                <select
                  className="sett-select"
                  value={keyStage}
                  onChange={(e) => handleKeyStageChange(e.target.value)}
                  disabled
                  title="Set during onboarding — can't be changed here"
                  style={{ width: "100%", marginBottom: 16, background: "#f8fafc", cursor: "not-allowed", color: "#475569" }}
                >
                  <option value="">Set during onboarding</option>
                  {hubKeyStages.map((ks) => (
                    <option key={ks} value={ks}>{KS_LABELS[ks] ?? ks}</option>
                  ))}
                </select>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                  Year Group <span style={{ fontWeight: 400, color: "#94a3b8" }}>🔒</span>
                </label>
                <select
                  className="sett-select"
                  value={yearGroup}
                  onChange={(e) => setYearGroup(e.target.value)}
                  disabled
                  title="Set during onboarding — can't be changed here"
                  style={{ width: "100%", marginBottom: 4, background: "#f8fafc", cursor: "not-allowed", color: "#475569" }}
                >
                  <option value="">Set during onboarding</option>
                  {/* Always include the saved value so it shows even before the year list loads. */}
                  {yearGroup && !hubYears.includes(yearGroup) && (
                    <option value={yearGroup}>{yearGroup}</option>
                  )}
                  {hubYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: "#64748b", marginTop: 4, marginBottom: 20 }}>
                  🔒 Your key stage and year group are set when you join and can't be changed here —
                  they update automatically as you progress through the school year.
                </p>
                <button className="sett-save-btn" onClick={saveProfile} disabled={saving}>
                  <Save size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            )}

            {/* ── PREFERENCES ── */}
            {activeTab === "preferences" && (
              <div className="sett-card">
                <p className="sett-card-title"><Sliders size={16} /> Preferences</p>
                <div className="sett-row">
                  <div>
                    <div className="sett-row-label">Voice Responses</div>
                    <div className="sett-row-sub">Hear your AI Tutor speak responses</div>
                  </div>
                  <label className="sett-toggle">
                    <input type="checkbox" checked={voiceResponses} onChange={(e) => setVoiceResponses(e.target.checked)} />
                    <span className="sett-toggle-slider" />
                  </label>
                </div>
                <div className="sett-row">
                  <div>
                    <div className="sett-row-label">Text Size</div>
                    <div className="sett-row-sub">Choose the text size that works best for you</div>
                  </div>
                  <div className="sett-text-size-row">
                    {(["sm", "md", "lg"] as const).map((s, i) => (
                      <button key={s} className={`sett-text-btn${textSize === s ? " selected" : ""}`} onClick={() => setTextSize(s)} style={{ fontSize: [12, 15, 19][i] }}>A</button>
                    ))}
                  </div>
                </div>
                <div className="sett-row">
                  <div>
                    <div className="sett-row-label">Dark Mode</div>
                    <div className="sett-row-sub">Switch between light and dark theme</div>
                  </div>
                  <label className="sett-toggle">
                    <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
                    <span className="sett-toggle-slider" />
                  </label>
                </div>
              </div>
            )}

            {/* ── LEARNING PREFERENCES ── */}
            {activeTab === "learning" && (
              <>
                <div className="sett-card">
                  <p className="sett-card-title"><BookOpen size={16} /> Learning Preferences</p>
                  <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>Tell us about how you learn best. Your AI Tutor will use this to personalise your lessons.</p>

                  <h4 style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 10px" }}>1. Learning Style</h4>
                  <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 10px" }}>You can select more than one.</p>
                  <div className="sett-style-grid">
                    {LEARNING_STYLES.map((s) => (
                      <div
                        key={s.id}
                        className={`sett-style-tile${learningStyles.includes(s.id) ? " selected" : ""}`}
                        onClick={() => toggleStyle(s.id)}
                      >
                        <span style={{ fontSize: 20 }}>{s.icon}</span> {s.label}
                      </div>
                    ))}
                  </div>

                  <h4 style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "16px 0 10px" }}>2. Teaching Pace</h4>
                  <div className="sett-pace-row">
                    {PACES.map((p) => (
                      <button
                        key={p.id}
                        className={`sett-pace-btn${pace === p.id ? " selected" : ""}`}
                        onClick={() => setPace(p.id)}
                      >
                        {p.icon} {p.label}
                      </button>
                    ))}
                  </div>

                  <h4 style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "16px 0 10px" }}>3. How should your tutor teach?</h4>
                  {TEACH_PREFS.map((tp) => (
                    <label key={tp.id} className="sett-check-label">
                      <input
                        type="checkbox"
                        checked={teachPrefs[tp.id] ?? false}
                        onChange={(e) => setTeachPrefs({ ...teachPrefs, [tp.id]: e.target.checked })}
                      />
                      {tp.label}
                    </label>
                  ))}

                  <h4 style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "16px 0 10px" }}>4. Interests & Hobbies</h4>
                  <div className="sett-tag-row">
                    {interests.map((tag) => (
                      <span key={tag} className="sett-tag">
                        {tag}
                        <button onClick={() => setInterests(interests.filter((i) => i !== tag))}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="sett-tag-input">
                    <input
                      value={interestInput}
                      onChange={(e) => setInterestInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addInterest()}
                      placeholder="e.g. Football, Space, Gaming..."
                    />
                    <button className="sett-tag-add" onClick={addInterest}>+ Add</button>
                  </div>

                  <h4 style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "16px 0 10px" }}>5. Learning Goals (optional)</h4>
                  <textarea
                    className="sett-input"
                    style={{ resize: "vertical", minHeight: 72 }}
                    value={learningGoals}
                    onChange={(e) => setLearningGoals(e.target.value)}
                    placeholder="e.g. Improve my maths for school exams, be better at problem solving..."
                  />

                  {personalisedSummary().length > 0 && (
                    <div className="sett-summary-box">
                      <h4>Your Personalised Learning Summary</h4>
                      <ul>
                        {personalisedSummary().map((l, i) => <li key={i}>{l}</li>)}
                      </ul>
                    </div>
                  )}

                  <div style={{ marginTop: 20 }}>
                    <button className="sett-save-btn" onClick={saveLearning} disabled={saving}>
                      <Save size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── NOTIFICATIONS ── */}
            {activeTab === "notifications" && (
              <div className="sett-card">
                <p className="sett-card-title"><Bell size={16} /> Notifications</p>
                {[
                  { id: "assignment_reminders", label: "Assignment Reminders", sub: "Get reminded about upcoming assignments" },
                  { id: "session_reminders",    label: "Session Reminders",    sub: "Remind me to keep up with my learning" },
                  { id: "messages",             label: "Messages",             sub: "New messages from teachers" },
                  { id: "weekly_progress",      label: "Weekly Progress",      sub: "Receive a weekly progress summary" },
                ].map((n) => (
                  <div key={n.id} className="sett-row">
                    <div>
                      <div className="sett-row-label">{n.label}</div>
                      <div className="sett-row-sub">{n.sub}</div>
                    </div>
                    <label className="sett-toggle">
                      <input
                        type="checkbox"
                        checked={(notifPrefs as Record<string, boolean>)[n.id] ?? false}
                        onChange={(e) => setNotifPrefs({ ...notifPrefs, [n.id]: e.target.checked })}
                      />
                      <span className="sett-toggle-slider" />
                    </label>
                  </div>
                ))}
                <div style={{ marginTop: 20 }}>
                  <button className="sett-save-btn" onClick={saveNotifications} disabled={saving}>
                    <Save size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            )}

            {/* ── ACCOUNT ── */}
            {activeTab === "account" && (
              <>
                <div className="sett-card">
                  <p className="sett-card-title"><Shield size={16} /> Account</p>
                  <div className="sett-row">
                    <div>
                      <div className="sett-row-label">Change Password</div>
                      <div className="sett-row-sub">Update your account password</div>
                    </div>
                    <button className="sett-save-btn" style={{ marginTop: 0 }} onClick={() => setShowPwForm((v) => !v)}>
                      {showPwForm ? "Cancel" : "Change"}
                    </button>
                  </div>

                  {showPwForm && (
                    <div style={{ marginTop: 16 }}>
                      <div className="sett-pw-row">
                        <input
                          className="sett-input" type={showCurrPw ? "text" : "password"}
                          value={currPw} onChange={(e) => setCurrPw(e.target.value)}
                          placeholder="Current password" style={{ paddingRight: 40, marginBottom: 0 }}
                        />
                        <span className="sett-pw-eye" onClick={() => setShowCurrPw((v) => !v)}>
                          {showCurrPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </span>
                      </div>
                      <div className="sett-pw-row" style={{ marginTop: 10 }}>
                        <input
                          className="sett-input" type={showNewPw ? "text" : "password"}
                          value={newPw} onChange={(e) => setNewPw(e.target.value)}
                          placeholder="New password (min 6 chars)" style={{ paddingRight: 40, marginBottom: 0 }}
                        />
                        <span className="sett-pw-eye" onClick={() => setShowNewPw((v) => !v)}>
                          {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </span>
                      </div>
                      <input
                        className="sett-input" type="password" style={{ marginTop: 10 }}
                        value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                        placeholder="Confirm new password"
                      />
                      <button className="sett-save-btn" onClick={savePassword} disabled={saving}>
                        {saving ? "Saving..." : "Update Password"}
                      </button>
                    </div>
                  )}

                  <div className="sett-row">
                    <div>
                      <div className="sett-row-label">Linked Accounts</div>
                      <div className="sett-row-sub">Connect external accounts</div>
                    </div>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Coming Soon</span>
                  </div>
                  <div className="sett-row">
                    <div>
                      <div className="sett-row-label">Privacy</div>
                      <div className="sett-row-sub">Manage your data and privacy settings</div>
                    </div>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Coming Soon</span>
                  </div>
                </div>

                <div className="sett-card" style={{ border: "1.5px solid #fecaca" }}>
                  <button className="sett-danger-btn" style={{ width: "100%" }} onClick={logout}>
                    <LogOut size={15} style={{ marginRight: 8, verticalAlign: "middle" }} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="sett-toast">{toast}</div>}
    </>
  );
}
