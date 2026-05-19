import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Bot,
  Sparkles,
  Presentation,
  ClipboardList,
  Target,
  BookOpen,
  Sprout,
  RefreshCw,
  GraduationCap,
  Upload,
  Lightbulb,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { gamificationApi, assignmentsApi, appointmentsApi, lessonsApi } from "../services/api";
import type { StudentProfile, MyAssignment } from "../types";

// ── Goal → session type mapping ─────────────────────────────────────────────

type GoalId = "learn_scratch" | "homework" | "catch_up" | "revision";
type LearnMode = "ai_recommended" | "slides" | "worksheet" | "quiz";

const SESSION_TYPE_CONFIG: Record<number, { emoji: string; label: string; sublabel: string; desc: string; recommended?: boolean }> = {
  20: { emoji: "⚡", label: "Quick Boost",   sublabel: "20 mins", desc: "Short focused support — homework, one concept, revision burst" },
  40: { emoji: "⭐", label: "Core Learning", sublabel: "40 mins", desc: "Best balance of focus, teaching and retention", recommended: true },
  60: { emoji: "🚀", label: "Deep Learning", sublabel: "1 hour",  desc: "Serious progress — GCSE/A-Level topics, major practice" },
  90: { emoji: "🏆", label: "Intensive",     sublabel: "90 mins", desc: "Exams and major catch-up — includes a brain break" },
};

function goalToSessionType(goal: GoalId): string {
  if (goal === "learn_scratch") return "Learn from Scratch";
  if (goal === "homework") return "Homework Help";
  if (goal === "catch_up") return "Catch Up";
  return "Revision";
}

function getAvailableDurations(studentKeyStage: string): number[] {
  if (!studentKeyStage || studentKeyStage === "KS1" || studentKeyStage === "KS2") {
    return [20, 40];
  }
  if (studentKeyStage === "KS3") return [20, 40, 60];
  return [20, 40, 60, 90]; // GCSE, A-Level, Degree
}

function durationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins === 60) return "1 Hour";
  return `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ""}`.trim();
}

// ── Dynamic lesson preview ───────────────────────────────────────────────────

interface PreviewStep {
  title: string;
  desc: string;
  time: number;
  isFirst?: boolean;
}

function getDynamicPreview(
  learnMode: LearnMode,
  _goal: GoalId,
  duration: number,
  topicLabel: string
): PreviewStep[] {
  let stepTitles: Array<{ title: string; desc: string }>;

  switch (learnMode) {
    case "slides":
      stepTitles = [
        { title: "Quick Recap", desc: "Review what you already know" },
        { title: "Learn with Slides", desc: "AI explains using guided slides" },
        { title: "Guided Questions", desc: "Test your understanding" },
        { title: "Review & Next Steps", desc: "Summary and key takeaways" },
      ];
      break;
    case "worksheet":
      stepTitles = [
        { title: "Introduction", desc: "Set the scene for today's work" },
        { title: "Guided Worksheet", desc: "Work through questions step-by-step" },
        { title: "Check Answers", desc: "Review with AI feedback" },
        { title: "Summary", desc: "What you've learned today" },
      ];
      break;
    case "quiz":
      stepTitles = [
        { title: "Warm Up", desc: "A couple of easy starter questions" },
        { title: "Quiz & Test Me", desc: "Test your knowledge fully" },
        { title: "Review Mistakes", desc: "Understand every wrong answer" },
        { title: "Final Score", desc: "See how well you did" },
      ];
      break;
    default: // ai_recommended
      stepTitles = [
        { title: "Quick Recap", desc: "Warm up and check prior knowledge" },
        { title: `Learn: ${topicLabel || "Topic"}`, desc: "Structured explanation with examples" },
        { title: "Guided Worksheet", desc: "Practice with step-by-step guidance" },
        { title: "Quick Challenge Quiz", desc: "Test what you've learned" },
        { title: "Review & Next Steps", desc: "Summary and recommended next topic" },
      ];
  }

  const firstTime = 5;
  const lastTime = 10;
  const middleCount = stepTitles.length - 2;
  const middleTime = middleCount > 0
    ? Math.floor((duration - firstTime - lastTime) / middleCount)
    : duration - firstTime - lastTime;

  return stepTitles.map((s, i) => ({
    ...s,
    time: i === 0 ? firstTime : i === stepTitles.length - 1 ? lastTime : middleTime,
    isFirst: i === 0,
  }));
}

// ── Focus checklist by goal ──────────────────────────────────────────────────

const FOCUS_ITEMS: Record<GoalId, string[]> = {
  homework:     ["Understanding the problem", "Step-by-step working", "Common mistakes to avoid", "Checking your answers"],
  learn_scratch: ["Core concepts explained", "Key definitions", "Worked examples", "Practice problems"],
  catch_up:     ["Identifying knowledge gaps", "Re-learning key concepts", "Catch-up exercises", "Building confidence"],
  revision:     ["Exam technique", "Key formulas & methods", "Timed practice questions", "Mark scheme awareness"],
};

// ── Types ────────────────────────────────────────────────────────────────────

interface LocationState {
  subject?: string;
  topic?: string;
  goal?: GoalId;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LessonSetupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const locationState = (location.state ?? {}) as LocationState;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Form state ──────────────────────────────────────────────────────────
  const [subject, setSubject] = useState(
    locationState.subject ?? searchParams.get("subject") ?? ""
  );
  const [keyStage, setKeyStage] = useState("");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [goal, setGoal] = useState<GoalId>(locationState.goal ?? "learn_scratch");
  const [learnMode, setLearnMode] = useState<LearnMode>("ai_recommended");
  const [duration, setDuration] = useState<number>(40);
  const [studentKeyStage, setStudentKeyStage] = useState<string>("");
  const [extraDetails, setExtraDetails] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [requirePasscode, setRequirePasscode] = useState(false);
  const [bookingPasscode, setBookingPasscode] = useState("");
  const [showExtra, setShowExtra] = useState(false);

  // ── KB data state ───────────────────────────────────────────────────────
  const [kbSubjects, setKbSubjects] = useState<string[]>([]);
  const [kbStages, setKbStages] = useState<string[]>([]);
  const [kbUnits, setKbUnits] = useState<Array<{ id: number; title: string; unit_name: string }>>([]);

  // ── Other data state ────────────────────────────────────────────────────
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [assignment, setAssignment] = useState<MyAssignment | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);

  // ── Submit state ────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────
  const canSubmit = subject.trim() !== "" && keyStage.trim() !== "" && selectedTopics.length > 0;

  // Fetch subjects + key stages from KB
  useEffect(() => {
    lessonsApi.getAvailableFilters()
      .then((data: any) => {
        setKbSubjects(data.subjects ?? []);
        setKbStages(data.key_stages ?? []);
      })
      .catch(() => {});
  }, []);

  // Fetch units when subject + key stage both selected
  useEffect(() => {
    if (!subject || !keyStage) {
      setKbUnits([]);
      setSelectedTopics([]);
      return;
    }
    lessonsApi.getUnits(subject, keyStage)
      .then((data: any) => {
        setKbUnits(data.units ?? []);
        setSelectedTopics([]);
      })
      .catch(() => setKbUnits([]));
  }, [subject, keyStage]);

  // Fetch gamification profile for stats bar
  useEffect(() => {
    gamificationApi
      .getProfile()
      .then((data) => {
        const p = data as StudentProfile;
        setProfile(p);
        if (p.key_stage) {
          setStudentKeyStage(p.key_stage);
          const available = getAvailableDurations(p.key_stage);
          setDuration(available.includes(40) ? 40 : available[0]);
        }
      })
      .catch(() => setProfile(null));
  }, []);

  // Fetch pending assignments for "From your teacher" panel
  useEffect(() => {
    assignmentsApi
      .getMy()
      .then((data: any) => {
        const list: MyAssignment[] = Array.isArray(data) ? data : data?.assignments ?? [];
        const first = list.find((a) => a.status !== "completed") ?? null;
        setAssignment(first);
      })
      .catch(() => setAssignment(null))
      .finally(() => setAssignmentLoading(false));
  }, []);

  // Reset on subject change
  const handleSubjectChange = (val: string) => {
    setSubject(val);
    setKeyStage("");
    setSelectedTopics([]);
  };

  const toggleTopic = (name: string) => {
    setSelectedTopics((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  // Pre-fill from assignment
  const handleUseAssignment = () => {
    if (!assignment) return;
    const hw = assignment.homework;
    setSubject(hw.subject ?? "");
    setKeyStage(hw.key_stage ?? "");
    if (hw.topic) setSelectedTopics([hw.topic]);
    setGoal("homework");
  };

  // File upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (idx: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Submit: create appointment then navigate to session ─────────────────
  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    setSubmitError(null);

    const sessionType = goalToSessionType(goal);
    const topicsStr = selectedTopics.join(", ");
    const titleStr = `${sessionType} - ${subject}: ${selectedTopics[0] ?? subject}`;
    const descParts = [
      `Topics: ${topicsStr}`,
      `Session type: ${sessionType}`,
      `Learning mode: ${learnMode}`,
    ];
    if (extraDetails.trim()) descParts.push(extraDetails.trim());

    try {
      const appointment = await appointmentsApi.book({
        student_id: user.id,
        teacher_id: user.id,
        subject,
        key_stage: keyStage,
        title: titleStr,
        scheduled_at: new Date().toISOString(),
        duration_minutes: duration,
        description: descParts.join("\n"),
        learn_mode: learnMode,
        passcode: requirePasscode && bookingPasscode.trim() ? bookingPasscode.trim() : undefined,
      }) as { id: number };

      // Upload any lesson files
      if (uploadedFiles.length > 0) {
        await Promise.allSettled(
          uploadedFiles.map(f => appointmentsApi.uploadLessonFile(appointment.id, f))
        );
      }

      navigate(`/session/${appointment.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to start lesson. Please try again.");
      setSubmitting(false);
    }
  };

  // ── Stats ────────────────────────────────────────────────────────────────
  const xpTotal  = profile?.xp_total ?? 0;
  const xpLevel  = profile?.xp_level ?? 1;
  const streak   = profile?.current_streak ?? 0;
  const xpInCurrentLevel = xpTotal % 100;

  // ── Goal options ────────────────────────────────────────────────────────
  const goalOptions: {
    id: GoalId;
    icon: React.ReactNode;
    label: string;
    desc: string;
    color: string;
    bg: string;
  }[] = [
    {
      id: "homework",
      icon: <BookOpen size={18} />,
      label: "Homework Help",
      desc: "Help me with my homework",
      color: "#6366f1",
      bg: "rgba(99,102,241,0.1)",
    },
    {
      id: "learn_scratch",
      icon: <Sprout size={18} />,
      label: "Learn from Scratch",
      desc: "Start from the basics",
      color: "#10b981",
      bg: "rgba(16,185,129,0.1)",
    },
    {
      id: "catch_up",
      icon: <RefreshCw size={18} />,
      label: "Catch Up",
      desc: "I missed a lesson or need to catch up",
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.1)",
    },
    {
      id: "revision",
      icon: <GraduationCap size={18} />,
      label: "Exam Revision",
      desc: "Prepare for a test or exam",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.1)",
    },
  ];

  // ── Learn mode options ──────────────────────────────────────────────────
  const learnModeOptions: {
    id: LearnMode;
    icon: React.ReactNode;
    label: string;
    desc: string;
    badge?: string;
    subLine?: string;
  }[] = [
    {
      id: "ai_recommended",
      icon: <Sparkles size={18} />,
      label: "AI Recommended",
      desc: "Best lesson plan for this topic and your learning style.",
      badge: "Recommended",
      subLine: "Slides → Worksheet → Quiz",
    },
    {
      id: "slides",
      icon: <Presentation size={18} />,
      label: "Learn with Slides",
      desc: "AI explains using guided slides",
    },
    {
      id: "worksheet",
      icon: <ClipboardList size={18} />,
      label: "Practice with Worksheet",
      desc: "Work through questions step-by-step",
    },
    {
      id: "quiz",
      icon: <Target size={18} />,
      label: "Quiz & Test Me",
      desc: "Test your knowledge with a quiz",
    },
  ];

  // Derived sidebar data
  const topicLabel = selectedTopics[0] ?? subject;
  const previewSteps = getDynamicPreview(learnMode, goal, duration, topicLabel);
  const focusItems = FOCUS_ITEMS[goal];
  const goalLabel = goalOptions.find((g) => g.id === goal)?.label ?? "";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg-primary)" }}>
      <Sidebar />

      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", height: "100%", display: "flex", flexDirection: "column" }}>
        <style>{`
          @media (max-width: 768px) {
            .lsp-two-col { flex-direction: column !important; padding: 16px 16px 120px !important; gap: 16px !important; }
            .lsp-right-col { display: none !important; }
          }
          .lsp-mode-card {
            flex: 1; position: relative; display: flex; flex-direction: column; gap: 6px;
            padding: 14px 14px 12px; border: 1.5px solid #e2e8f0; border-radius: 10px;
            background: var(--bg-primary); cursor: pointer; text-align: left;
            transition: border-color 0.15s, background 0.15s; font-family: inherit;
            min-width: 0;
          }
          .lsp-mode-card:hover { border-color: #1a73e8; }
          .lsp-mode-card.active { border-color: #1a73e8; background: #eff6ff; }
          .lsp-mode-badge {
            position: absolute; top: 10px; right: 10px;
            background: #10b981; color: #fff; font-size: 9px; font-weight: 800;
            padding: 2px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.5px;
          }
          .lsp-upload-area {
            border: 2px dashed #cbd5e1; border-radius: 10px; padding: 20px 18px;
            display: flex; align-items: center; gap: 20px; cursor: pointer;
            transition: border-color 0.15s, background 0.15s; background: var(--bg-primary);
          }
          .lsp-upload-area:hover { border-color: #1a73e8; background: #eff6ff; }
          .lsp-step-connector { width: 2px; height: 12px; background: #e2e8f0; margin: 0 auto; }
          .lsp-dur-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
          @media (max-width: 500px) { .lsp-dur-grid { grid-template-columns: 1fr; } }
          .lsp-dur-card {
            border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px;
            cursor: pointer; background: var(--bg-secondary,#fff); text-align: left;
            transition: border-color 0.15s, box-shadow 0.15s;
            position: relative; display: flex; flex-direction: column; gap: 4px;
            font-family: inherit;
          }
          .lsp-dur-card:hover:not(:disabled) { border-color: #1a73e8; box-shadow: 0 2px 8px rgba(26,115,232,0.12); }
          .lsp-dur-card.active { border-color: #1a73e8; background: #eff6ff; box-shadow: 0 2px 8px rgba(26,115,232,0.15); }
          .lsp-dur-card:disabled { opacity: 0.4; cursor: not-allowed; }
          .lsp-dur-emoji { font-size: 22px; }
          .lsp-dur-label { font-size: 14px; font-weight: 800; color: #0f172a; }
          .lsp-dur-sub { font-size: 12px; font-weight: 600; color: #1a73e8; }
          .lsp-dur-desc { font-size: 11px; color: #64748b; line-height: 1.4; }
          .lsp-dur-badge {
            position: absolute; top: 10px; right: 10px;
            background: #10b981; color: #fff; font-size: 9px; font-weight: 800;
            padding: 2px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.5px;
          }
          .lsp-ks-note { font-size: 12px; color: #64748b; margin-top: 2px; margin-bottom: 16px; padding: 8px 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
        `}</style>

        {/* ── Hero banner ─────────────────────────────────────────────────── */}
        <div style={{
          background: "linear-gradient(135deg, #1a73e8 0%, #6366f1 60%, #8b5cf6 100%)",
          width: "100%",
          padding: "18px 28px",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxSizing: "border-box",
          flexShrink: 0,
        }}>
          {/* Decorative circles */}
          <div style={{
            position: "absolute", top: -40, left: -40,
            width: 180, height: 180, borderRadius: "50%",
            background: "rgba(255,255,255,0.07)", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", bottom: -30, left: 200,
            width: 120, height: 120, borderRadius: "50%",
            background: "rgba(255,255,255,0.07)", pointerEvents: "none",
          }} />

          {/* Left: heading + subtitle */}
          <div style={{ position: "relative", zIndex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "0 0 4px", lineHeight: 1.2 }}>
              Let's set up your lesson 👋
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0 }}>
              Your AI Tutor will personalise the lesson just for you.
            </p>
          </div>

          {/* Right: stat chips */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            position: "relative", zIndex: 1, paddingRight: 120,
          }}>
            {/* Session length chip — uses live duration */}
            <span style={chipStyle}>
              ⏱ Session — {durationLabel(duration)}
            </span>
            <span style={chipStyle}>🔥 {streak} Day Streak</span>
            <span style={chipStyle}>⭐ {xpTotal} XP</span>
            <span style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 99, padding: "5px 12px",
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
                Level {xpLevel}
              </span>
              <div style={{ width: 64, height: 6, borderRadius: 99, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 99, background: "#fff",
                  width: `${xpInCurrentLevel}%`, transition: "width 0.4s ease",
                }} />
              </div>
            </span>
          </div>

          {/* Robot image */}
          <img
            src="/images/robotAI.png"
            alt=""
            style={{ position: "absolute", bottom: 0, right: 16, width: 110, pointerEvents: "none", zIndex: 1 }}
          />
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {/* ── Two-column layout ─────────────────────────────────────────── */}
          <div style={s.twoCol} className="lsp-two-col">

            {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
            <div style={s.leftCol}>

              {/* STEP 1 */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>1</span>
                  <div>
                    <div style={s.stepTitle}>What do you want to learn?</div>
                    <div style={s.stepSubtitle}>Choose the subject and topic for your lesson.</div>
                  </div>
                </div>

                {/* Three dropdowns in a row */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {/* Subject */}
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={s.label}>Subject</label>
                    <div style={s.selectWrap}>
                      <select
                        style={s.select as React.CSSProperties}
                        value={subject}
                        onChange={(e) => handleSubjectChange(e.target.value)}
                      >
                        <option value="">Select subject...</option>
                        {kbSubjects.map((sub) => (
                          <option key={sub} value={sub}>{sub}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} style={s.selectArrow as React.CSSProperties} />
                    </div>
                  </div>

                  {/* Key Stage */}
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={s.label}>Key Stage</label>
                    <div style={s.selectWrap}>
                      <select
                        style={{ ...s.select as React.CSSProperties, opacity: subject ? 1 : 0.5 }}
                        value={keyStage}
                        onChange={(e) => { setKeyStage(e.target.value); setSelectedTopics([]); }}
                        disabled={!subject}
                      >
                        <option value="">Select key stage...</option>
                        {kbStages.map((ks) => (
                          <option key={ks} value={ks}>{ks}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} style={s.selectArrow as React.CSSProperties} />
                    </div>
                  </div>
                </div>

                {/* Topics — multi-select chips */}
                {keyStage && (
                  <div style={{ marginTop: 14 }}>
                    <label style={s.label}>
                      Topics
                      {selectedTopics.length > 0 && (
                        <span style={{ fontWeight: 400, color: "#1a73e8", marginLeft: 6 }}>
                          {selectedTopics.length} selected
                        </span>
                      )}
                    </label>
                    {kbUnits.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
                        No topics available for this combination.
                      </p>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {kbUnits.map((unit) => {
                          const sel = selectedTopics.includes(unit.unit_name);
                          return (
                            <button
                              key={unit.id}
                              type="button"
                              onClick={() => {
                                setSelectedTopics((prev) =>
                                  prev.includes(unit.unit_name)
                                    ? prev.filter((t) => t !== unit.unit_name)
                                    : [...prev, unit.unit_name]
                                );
                              }}
                              style={{
                                padding: "5px 12px",
                                borderRadius: 99,
                                fontSize: 12,
                                fontWeight: 600,
                                border: `1.5px solid ${sel ? "#1a73e8" : "var(--border-color,#e2e8f0)"}`,
                                background: sel ? "rgba(26,115,232,0.1)" : "var(--bg-primary)",
                                color: sel ? "#1a73e8" : "var(--text-secondary)",
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "border-color 0.15s, background 0.15s",
                              }}
                            >
                              {unit.title}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Assignment recommended-by note */}
                {assignment && (
                  <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13 }}>👤</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Recommended by:{" "}
                      <strong style={{ color: "var(--text-secondary)" }}>your teacher</strong>
                      {" "}—{" "}
                      <button
                        type="button"
                        style={{ fontSize: 12, color: "#1a73e8", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", fontWeight: 600 }}
                        onClick={handleUseAssignment}
                      >
                        Use this assignment
                      </button>
                    </span>
                  </div>
                )}
              </div>

              {/* STEP 2 — Goal / Focus */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>2</span>
                  <div>
                    <div style={s.stepTitle}>What is your goal?</div>
                    <div style={s.stepSubtitle}>This helps your tutor teach in the right way.</div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {goalOptions.map((g) => {
                    const sel = goal === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setGoal(g.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 14,
                          padding: "14px 16px",
                          border: `1.5px solid ${sel ? "#1a73e8" : "#e2e8f0"}`,
                          borderRadius: 10,
                          background: sel ? "#eff6ff" : "var(--bg-primary)",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s",
                          fontFamily: "inherit",
                        }}
                      >
                        <span style={{
                          width: 36, height: 36, borderRadius: 8,
                          background: g.bg,
                          color: g.color,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          {g.icon}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: sel ? "#1a73e8" : "var(--text-primary)", marginBottom: 2 }}>
                            {g.label}
                          </span>
                          <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
                            {g.desc}
                          </span>
                        </span>
                        {sel && (
                          <span style={{
                            width: 18, height: 18, borderRadius: "50%",
                            background: "#1a73e8", color: "#fff",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 800, flexShrink: 0,
                          }}>
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* STEP 3 — Duration */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>3</span>
                  <span style={s.stepTitle}>How long would you like your session to be?</span>
                </div>
                <div className="lsp-dur-grid">
                  {([20, 40, 60, 90] as number[]).map((mins) => {
                    const cfg = SESSION_TYPE_CONFIG[mins];
                    const available = getAvailableDurations(studentKeyStage);
                    const isAvailable = available.includes(mins);
                    return (
                      <button
                        key={mins}
                        type="button"
                        className={`lsp-dur-card${duration === mins ? " active" : ""}`}
                        disabled={!isAvailable}
                        onClick={() => isAvailable && setDuration(mins)}
                        title={!isAvailable ? `Available for GCSE/A-Level and above` : undefined}
                      >
                        {cfg.recommended && <span className="lsp-dur-badge">Recommended</span>}
                        <span className="lsp-dur-emoji">{cfg.emoji}</span>
                        <span className="lsp-dur-label">{cfg.label}</span>
                        <span className="lsp-dur-sub">{cfg.sublabel}</span>
                        <span className="lsp-dur-desc">{cfg.desc}</span>
                      </button>
                    );
                  })}
                </div>
                {!studentKeyStage && (
                  <p className="lsp-ks-note">
                    Set your Key Stage in <strong>Settings → Profile</strong> to unlock all session lengths available to your level.
                  </p>
                )}
              </div>

              {/* STEP 4 — Learn Mode */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>4</span>
                  <div>
                    <div style={s.stepTitle}>How should we learn this today?</div>
                    <div style={s.stepSubtitle}>Choose how you'd like your tutor to help.</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {learnModeOptions.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`lsp-mode-card${learnMode === m.id ? " active" : ""}`}
                      onClick={() => setLearnMode(m.id)}
                    >
                      {m.badge && <span className="lsp-mode-badge">{m.badge}</span>}
                      <span style={{
                        color: learnMode === m.id ? "#1a73e8" : "var(--text-secondary)",
                        display: "flex", alignItems: "center",
                      }}>
                        {m.icon}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: learnMode === m.id ? "#1a73e8" : "var(--text-primary)" }}>
                        {m.label}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{m.desc}</span>
                      {m.subLine && (
                        <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700, marginTop: 2 }}>{m.subLine}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* STEP 5 — File Upload */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>5</span>
                  <div>
                    <div style={s.stepTitle}>
                      Add school work
                      <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>(optional)</span>
                    </div>
                    <div style={s.stepSubtitle}>Upload anything your tutor should go through with you.</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {/* Drop zone */}
                  <div
                    className="lsp-upload-area"
                    style={{ flex: 2, minWidth: 220 }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={28} style={{ color: "#94a3b8", flexShrink: 0 }} />
                    <div>
                      <p style={{ margin: "0 0 3px", fontSize: 13, color: "var(--text-secondary)" }}>
                        Drag and drop files here or{" "}
                        <strong style={{ color: "#1a73e8" }}>click to browse</strong>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
                        PDF, PPTX, DOCX, Images — Max 25 MB
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg"
                      style={{ display: "none" }}
                      onChange={handleFileChange}
                    />
                  </div>

                  {/* Supported formats info */}
                  <div style={{
                    flex: 1, minWidth: 160,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "12px 14px",
                  }}>
                    <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>
                      Supported files:
                    </p>
                    {["PDF", "PPTX", "DOCX", "Images"].map((fmt) => (
                      <span key={fmt} style={{
                        display: "inline-block",
                        margin: "2px 4px 2px 0",
                        padding: "2px 8px",
                        background: "#e2e8f0",
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#475569",
                      }}>
                        {fmt}
                      </span>
                    ))}
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                      Max file size: 25 MB
                    </p>
                  </div>
                </div>

                {/* Selected files list */}
                {uploadedFiles.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {uploadedFiles.map((f, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 12px",
                        background: "#f0f9ff",
                        border: "1px solid #bae6fd",
                        borderRadius: 7,
                        fontSize: 12,
                        color: "#0369a1",
                      }}>
                        <span style={{ fontWeight: 600 }}>{f.name}</span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14, padding: "0 0 0 8px", fontFamily: "inherit" }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add more details accordion */}
              <button
                type="button"
                style={s.accordionBtn as React.CSSProperties}
                onClick={() => setShowExtra((v) => !v)}
              >
                <ChevronDown
                  size={14}
                  style={{
                    transform: showExtra ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s",
                    marginRight: 6,
                  }}
                />
                + Add more details (optional)
              </button>
              {showExtra && (
                <textarea
                  style={s.textarea as React.CSSProperties}
                  value={extraDetails}
                  onChange={(e) => setExtraDetails(e.target.value)}
                  placeholder="Any extra context, materials, or specific areas to focus on..."
                  rows={4}
                />
              )}

              {/* Passcode */}
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={requirePasscode}
                    onChange={(e) => {
                      setRequirePasscode(e.target.checked);
                      if (!e.target.checked) setBookingPasscode("");
                    }}
                    style={{ width: 15, height: 15, accentColor: "#1a73e8", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    Require passcode to join
                  </span>
                </label>
                {requirePasscode && (
                  <input
                    type="text"
                    placeholder="e.g. ABC123"
                    value={bookingPasscode}
                    onChange={(e) => setBookingPasscode(e.target.value.toUpperCase())}
                    maxLength={16}
                    style={{
                      ...(s.input as React.CSSProperties),
                      letterSpacing: 3,
                      width: 200,
                      fontWeight: 700,
                    }}
                  />
                )}
              </div>

              {/* Error message */}
              {submitError && (
                <div style={{
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#ef4444", fontWeight: 500,
                }}>
                  {submitError}
                </div>
              )}

            </div>

            {/* ── RIGHT SIDEBAR ─────────────────────────────────────────────── */}
            <div style={s.rightCol} className="lsp-right-col">

              {/* Panel 1: Lesson Preview */}
              <div style={s.rightCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <LayoutGrid size={16} style={{ color: "#1a73e8", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Lesson Preview</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
                  Here's what we'll cover in your {durationLabel(duration)} session.
                </p>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {previewSteps.map((step, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                          <span style={{
                            padding: "2px 8px",
                            borderRadius: 99,
                            fontSize: 10,
                            fontWeight: 700,
                            background: step.isFirst ? "#10b981" : "#1a73e8",
                            color: "#fff",
                            whiteSpace: "nowrap",
                          }}>
                            {step.time} min
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, paddingBottom: i < previewSteps.length - 1 ? 4 : 0 }}>
                          <p style={{ margin: "0 0 1px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                            {i + 1}. {step.title}
                          </p>
                          <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                            {step.desc}
                          </p>
                        </div>
                      </div>
                      {i < previewSteps.length - 1 && (
                        <div className="lsp-step-connector" style={{ marginLeft: 21, marginTop: 4, marginBottom: 8 }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 2: From your teacher (only if assignment exists) */}
              {!assignmentLoading && assignment && (
                <div style={s.rightCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>From your teacher</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "#e2e8f0", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: 18, flexShrink: 0,
                    }}>
                      👤
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, background: "rgba(26,115,232,0.1)",
                          color: "#1a73e8", borderRadius: 99, padding: "2px 8px",
                        }}>
                          {assignment.homework.subject}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, background: "rgba(0,0,0,0.06)",
                          color: "var(--text-muted)", borderRadius: 99, padding: "2px 8px",
                          textTransform: "capitalize" as const,
                        }}>
                          {assignment.homework.assignment_type}
                        </span>
                      </div>
                      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                        {assignment.homework.title}
                      </p>
                      {assignment.homework.topic && (
                        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>
                          Topic: {assignment.homework.topic}
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" style={s.useBtn} onClick={handleUseAssignment}>Use This</button>
                        <button type="button" style={s.ignoreBtn} onClick={() => setAssignment(null)}>Ignore</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Panel 3: What we'll focus on (only if subject or topic selected) */}
              {(subject || selectedTopics.length > 0) && (
                <div style={s.rightCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>What we'll focus on</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {focusItems.map((item, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: "50%",
                          background: "#dcfce7", color: "#16a34a",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 800, flexShrink: 0, marginTop: 1,
                        }}>
                          ✓
                        </span>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.4 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Panel 4: AI Personalisation — always visible */}
              <div style={s.rightCard}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Bot size={20} style={{ color: "#1a73e8", flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <strong style={{ display: "block", marginBottom: 2, color: "var(--text-primary)" }}>
                      AI Tutor will personalise this lesson for you
                    </strong>
                    We'll adapt the pace, examples and questions based on how you learn best.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ── Sticky bottom bar ──────────────────────────────────────────────── */}
        <div style={{
          position: "sticky",
          bottom: 0,
          background: "var(--bg-secondary)",
          borderTop: "1px solid #e2e8f0",
          padding: "14px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
          flexShrink: 0,
          gap: 12,
          flexWrap: "wrap",
        }}>
          {/* Left: status summary */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {canSubmit ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>✓ You're all set!</span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", background: "#eff6ff", borderRadius: 99,
                  fontSize: 12, fontWeight: 600, color: "#1a73e8",
                }}>
                  📚 Topic: {selectedTopics[0] ?? subject}
                </span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", background: "#f0fdf4", borderRadius: 99,
                  fontSize: 12, fontWeight: 600, color: "#16a34a",
                }}>
                  🎯 Focus: {goalLabel}
                </span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", background: "#fff7ed", borderRadius: 99,
                  fontSize: 12, fontWeight: 600, color: "#ea580c",
                }}>
                  ⏱ {duration} min
                </span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Complete steps 1–3 to start your lesson.
              </span>
            )}
          </div>

          {/* Right: CTA */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button
              type="button"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "12px 24px",
                background: canSubmit && !submitting ? "#1a73e8" : "#94a3b8",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                transition: "background 0.15s",
                whiteSpace: "nowrap",
              }}
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Starting your lesson..." : (
                <>Start Lesson with AI Tutor <ChevronRight size={16} /></>
              )}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              🛡️ You can adjust anything during the lesson.
            </span>
          </div>
        </div>

      </main>
    </div>
  );
}

// ── Shared chip style for hero ───────────────────────────────────────────────

const chipStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: "rgba(255,255,255,0.15)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 99,
  padding: "5px 12px",
  whiteSpace: "nowrap",
};

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // Layout
  twoCol: {
    display: "flex",
    gap: 24,
    padding: "24px 28px 32px",
    alignItems: "flex-start",
  },
  leftCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minWidth: 0,
  },
  rightCol: {
    width: 300,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    position: "sticky",
    top: 24,
  },

  // Step cards
  stepCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "20px 22px",
  },
  stepHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#1a73e8",
    color: "#fff",
    fontSize: 13,
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    lineHeight: 1.3,
  },
  stepSubtitle: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 2,
  },

  // Form controls
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
  },
  selectWrap: {
    position: "relative",
  },
  select: {
    width: "100%",
    padding: "10px 36px 10px 12px",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 14,
    appearance: "none",
    cursor: "pointer",
    outline: "none",
    fontFamily: "inherit",
  },
  selectArrow: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    pointerEvents: "none",
    color: "var(--text-muted)",
  },

  // Textarea
  textarea: {
    width: "100%",
    borderRadius: 8,
    border: "1.5px solid var(--border-color,#e2e8f0)",
    padding: "10px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    resize: "vertical",
    background: "var(--bg-primary,#fff)",
    color: "var(--text-primary,#0f172a)",
    outline: "none",
    boxSizing: "border-box",
  },

  // Accordion button
  accordionBtn: {
    background: "none",
    border: "1px dashed var(--border-color,#e2e8f0)",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary,#64748b)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    marginBottom: 8,
    fontFamily: "inherit",
  },

  // Text input
  input: {
    border: "1.5px solid var(--border-color,#e2e8f0)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    background: "var(--bg-primary,#fff)",
    color: "var(--text-primary,#0f172a)",
    outline: "none",
  },

  // Right panel cards
  rightCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "18px 20px",
  },

  // Assignment action buttons
  useBtn: {
    padding: "6px 14px",
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  ignoreBtn: {
    padding: "6px 14px",
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px solid var(--border-color)",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
};
