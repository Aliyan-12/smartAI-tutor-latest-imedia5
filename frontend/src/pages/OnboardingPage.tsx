import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, curriculumApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

const STYLES = [
  { id: "visual", label: "Visual (diagrams, pictures)" },
  { id: "step_by_step", label: "Step-by-step" },
  { id: "examples", label: "Lots of examples" },
  { id: "practice", label: "Practice as we go" },
];
const PACES = [
  { id: "slower", label: "Take it slow" },
  { id: "just_right", label: "Just right" },
  { id: "faster", label: "Move quickly" },
];

const wrap: React.CSSProperties = {
  display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(160deg,#0a0a15,#111127 55%,#0d1a2e)", padding: 24,
  fontFamily: "DM Sans, -apple-system, sans-serif",
};
const card: React.CSSProperties = {
  width: "100%", maxWidth: 520, background: "#fff", borderRadius: 18, padding: "34px 32px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#2c2c2c", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 0.3 };
const input: React.CSSProperties = { width: "100%", padding: "11px 13px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontFamily: "inherit" };
const btn: React.CSSProperties = { width: "100%", padding: 13, background: "#1a73e8", color: "#fff", border: "none", borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 20 };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "8px 12px", borderRadius: 20, border: `1.5px solid ${active ? "#1a73e8" : "#e2e8f0"}`,
  background: active ? "#1a73e8" : "#fff", color: active ? "#fff" : "#475569",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
});
const muted: React.CSSProperties = { fontSize: 12, color: "#94a3b8", margin: "6px 0 0" };

export default function OnboardingPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "student";

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // student — curriculum cascade (dynamic, from Resource Hub)
  const [ksList, setKsList] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [subjectList, setSubjectList] = useState<string[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  const [keyStage, setKeyStage] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [pace, setPace] = useState("just_right");
  const [voice, setVoice] = useState(true);
  // parent / school
  const [inviteCode, setInviteCode] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [country, setCountry] = useState("");

  // Load key stages once (students only).
  useEffect(() => {
    if (role !== "student") return;
    curriculumApi.getKeyStages()
      .then((d) => setKsList(d.keystages || []))
      .catch(() => setKsList([]));
  }, [role]);

  // KS → year groups
  useEffect(() => {
    if (!keyStage) { setYears([]); return; }
    setLoadingYears(true);
    curriculumApi.getYears(keyStage)
      .then((d) => setYears(d.years || []))
      .catch(() => setYears([]))
      .finally(() => setLoadingYears(false));
  }, [keyStage]);

  // KS (+ year) → subjects
  useEffect(() => {
    if (!keyStage) { setSubjectList([]); return; }
    setLoadingSubjects(true);
    curriculumApi.getSubjects(keyStage, yearGroup || undefined)
      .then((d) => setSubjectList((d.subjects || []).map((s) => s.name)))
      .catch(() => setSubjectList([]))
      .finally(() => setLoadingSubjects(false));
  }, [keyStage, yearGroup]);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const selectKs = (k: string) => { setKeyStage(k); setYearGroup(""); setSubjects([]); };
  const selectYear = (y: string) => { setYearGroup(y); setSubjects([]); };

  const finish = async () => {
    setSaving(true); setError("");
    try {
      await authApi.onboarding.complete();
      await refreshUser();
      navigate("/", { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  };

  const saveStudentProfile = async () => {
    setSaving(true); setError("");
    try {
      await authApi.onboarding.profile({ key_stage: keyStage, year_group: yearGroup, subjects });
      setStep(1); setSaving(false);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); setSaving(false); }
  };

  const saveStudentPrefs = async () => {
    setSaving(true); setError("");
    try {
      await authApi.onboarding.preferences({ learning_style: styles, teaching_pace: pace, voice_responses: voice });
      await finish();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); setSaving(false); }
  };

  const saveParent = async () => {
    setSaving(true); setError("");
    try {
      if (inviteCode.trim()) await authApi.onboarding.profile({ invite_code: inviteCode.trim() });
      await finish();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); setSaving(false); }
  };

  const saveSchool = async () => {
    setSaving(true); setError("");
    try {
      await authApi.onboarding.profile({ school_name: schoolName || undefined, country: country || undefined });
      await finish();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); setSaving(false); }
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <img src="/images/aitutor 4 schools.png" alt="AI Tutor 4 Schools" style={{ height: 56, marginBottom: 10 }} />
        <h2 style={{ margin: "0 0 4px", color: "#1e293b" }}>Welcome, {user?.name?.split(" ")[0] || "there"}! 👋</h2>

        {role === "student" && step === 0 && (
          <>
            <p style={{ color: "#64748b", margin: 0 }}>Tell us where you're learning so lessons match your curriculum.</p>

            <label style={label}>Key Stage</label>
            {ksList.length === 0 ? <p style={muted}>Loading key stages…</p> : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ksList.map((k) => <button key={k} style={chip(keyStage === k)} onClick={() => selectKs(k)}>{k}</button>)}
              </div>
            )}

            <label style={label}>Year Group</label>
            {!keyStage ? <p style={muted}>Pick a key stage first.</p>
              : loadingYears ? <p style={muted}>Loading year groups…</p>
              : years.length === 0 ? <p style={muted}>No year groups found for {keyStage}.</p>
              : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {years.map((y) => <button key={y} style={chip(yearGroup === y)} onClick={() => selectYear(y)}>{y}</button>)}
                </div>
              )}

            <label style={label}>Subjects you want help with</label>
            {!keyStage ? <p style={muted}>Pick a key stage first.</p>
              : loadingSubjects ? <p style={muted}>Loading subjects…</p>
              : subjectList.length === 0 ? <p style={muted}>No subjects found yet for this selection.</p>
              : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {subjectList.map((s) => <button key={s} style={chip(subjects.includes(s))} onClick={() => toggle(subjects, s, setSubjects)}>{s}</button>)}
                </div>
              )}

            {error && <p style={{ color: "#dc2626", marginTop: 12 }}>{error}</p>}
            <button style={btn} onClick={saveStudentProfile} disabled={saving || !keyStage}>{saving ? "Saving…" : "Continue →"}</button>
          </>
        )}

        {role === "student" && step === 1 && (
          <>
            <p style={{ color: "#64748b", margin: 0 }}>How do you like to learn?</p>
            <label style={label}>Learning style</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {STYLES.map((s) => <button key={s.id} style={chip(styles.includes(s.id))} onClick={() => toggle(styles, s.id, setStyles)}>{s.label}</button>)}
            </div>
            <label style={label}>Pace</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PACES.map((p) => <button key={p.id} style={chip(pace === p.id)} onClick={() => setPace(p.id)}>{p.label}</button>)}
            </div>
            <label style={{ ...label, display: "flex", alignItems: "center", gap: 8, textTransform: "none", cursor: "pointer" }}>
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Enable voice responses from the tutor
            </label>
            {error && <p style={{ color: "#dc2626", marginTop: 12 }}>{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...btn, background: "#fff", color: "#475569", border: "1.5px solid #e2e8f0" }} onClick={() => setStep(0)} disabled={saving}>← Back</button>
              <button style={btn} onClick={saveStudentPrefs} disabled={saving}>{saving ? "Saving…" : "Finish setup →"}</button>
            </div>
          </>
        )}

        {role === "parent" && (
          <>
            <p style={{ color: "#64748b", margin: 0 }}>Link your child's account with their invite code (you can skip and do this later).</p>
            <label style={label}>Child invite code</label>
            <input style={input} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="e.g. 8F2A9C1B" />
            {error && <p style={{ color: "#dc2626", marginTop: 12 }}>{error}</p>}
            <button style={btn} onClick={saveParent} disabled={saving}>{saving ? "Saving…" : "Finish setup →"}</button>
          </>
        )}

        {role === "superadmin" && (
          <>
            <p style={{ color: "#64748b", margin: 0 }}>Set up your school.</p>
            <label style={label}>School name</label>
            <input style={input} value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="Your school's name" />
            <label style={label}>Country</label>
            <input style={input} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United Kingdom" />
            {error && <p style={{ color: "#dc2626", marginTop: 12 }}>{error}</p>}
            <button style={btn} onClick={saveSchool} disabled={saving}>{saving ? "Saving…" : "Finish setup →"}</button>
          </>
        )}

        {(role === "admin" || role === "teacher") && (
          <>
            <p style={{ color: "#64748b" }}>You're all set.</p>
            <button style={btn} onClick={finish} disabled={saving}>{saving ? "…" : "Continue →"}</button>
          </>
        )}
      </div>
    </div>
  );
}
