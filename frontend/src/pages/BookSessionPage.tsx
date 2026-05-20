import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, ArrowLeft, User, BookOpen,
  CheckCircle, Info, ChevronRight, LayoutGrid,
  Sprout, RefreshCw, GraduationCap,
  Sparkles, Presentation, ClipboardList, Target,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { appointmentsApi, teacherApi, parentApi, lessonsApi } from "../services/api";
import type { User as UserType } from "../types";

// ── Session type constants ────────────────────────────────────────────────────

const SESSION_TYPES = [
  "Learn from Scratch",
  "Homework Help",
  "Catch Up",
  "Revision",
  "General Tutoring",
];

const SESSION_GOAL_OPTIONS = [
  { id: "Homework Help",      icon: <BookOpen size={18} />,     label: "Homework Help",      desc: "Help me with my homework",              color: "#6366f1", bg: "rgba(99,102,241,0.15)",    cardBg: "#f5f3ff", cardBorder: "#c4b5fd" },
  { id: "Learn from Scratch", icon: <Sprout size={18} />,       label: "Learn from Scratch", desc: "Start from the basics",                 color: "#10b981", bg: "rgba(16,185,129,0.15)",    cardBg: "#ecfdf5", cardBorder: "#6ee7b7" },
  { id: "Catch Up",           icon: <RefreshCw size={18} />,    label: "Catch Up",           desc: "I missed a lesson or need to catch up", color: "#f59e0b", bg: "rgba(245,158,11,0.15)",    cardBg: "#fffbeb", cardBorder: "#fcd34d" },
  { id: "Revision",           icon: <GraduationCap size={18} />, label: "Exam Revision",     desc: "Prepare for a test or exam",            color: "#ef4444", bg: "rgba(239,68,68,0.15)",     cardBg: "#fff5f5", cardBorder: "#fca5a5" },
];

const LEARN_MODE_OPTIONS = [
  { id: "ai_recommended" as const, icon: <Sparkles size={18} />,     label: "AI Recommended",       desc: "Best plan for this topic",       badge: "Recommended", color: "#1a73e8", iconBg: "rgba(26,115,232,0.12)",   cardBg: "#eff6ff", cardBorder: "#93c5fd" },
  { id: "slides"         as const, icon: <Presentation size={18} />,  label: "Learn with Slides",    desc: "AI explains using guided slides", color: "#8b5cf6", iconBg: "rgba(139,92,246,0.12)",  cardBg: "#f5f3ff", cardBorder: "#c4b5fd" },
  { id: "worksheet"      as const, icon: <ClipboardList size={18} />, label: "Practice Worksheet",   desc: "Work through questions step-by-step", color: "#f97316", iconBg: "rgba(249,115,22,0.12)",  cardBg: "#fff7ed", cardBorder: "#fed7aa" },
  { id: "quiz"           as const, icon: <Target size={18} />,        label: "Quiz & Test Me",       desc: "Test knowledge with a quiz",    color: "#14b8a6", iconBg: "rgba(20,184,166,0.12)", cardBg: "#f0fdfa", cardBorder: "#99f6e4" },
];

const SESSION_TYPE_DURATIONS = [
  { value: "20", emoji: "⚡", name: "Quick Boost",   sublabel: "20 mins",  desc: "Short focused support — homework, one concept, revision burst" },
  { value: "40", emoji: "⭐", name: "Core Learning", sublabel: "40 mins",  desc: "Best balance of focus, teaching and retention", recommended: true },
  { value: "60", emoji: "🚀", name: "Deep Learning", sublabel: "1 hour",   desc: "Serious progress — GCSE/A-Level topics" },
  { value: "90", emoji: "🏆", name: "Intensive",     sublabel: "90 mins",  desc: "Exams & major catch-up — includes a brain break" },
];

function getAvailableDurations(keyStage: string): number[] {
  if (!keyStage || keyStage === "KS1" || keyStage === "KS2") return [20, 40];
  if (keyStage === "KS3") return [20, 40, 60];
  return [20, 40, 60, 90];
}

// ── Lesson plan preview data (mirrors LessonSetupPage) ───────────────────────

type GoalId = "learn_scratch" | "homework" | "catch_up" | "revision";
type StepColor = "green" | "blue" | "yellow" | "purple";

interface PlanStep { color: StepColor; time: number; title: string; desc?: string; }

const STEP_COLOR_HEX: Record<StepColor, string> = {
  green: "#22c55e", blue: "#3b82f6", yellow: "#f59e0b", purple: "#8b5cf6",
};

function sessionTypeToGoalId(sessionType: string): GoalId {
  if (sessionType === "Homework Help") return "homework";
  if (sessionType === "Catch Up") return "catch_up";
  if (sessionType === "Revision") return "revision";
  return "learn_scratch";
}

const LESSON_PLAN_DATA: Record<number, Record<GoalId, PlanStep[]>> = {
  20: {
    learn_scratch: [
      { color: "green",  time: 2, title: "Quick Recap / Prior Knowledge" },
      { color: "blue",   time: 5, title: "Learn Topic" },
      { color: "blue",   time: 5, title: "Guided Practice" },
      { color: "blue",   time: 4, title: "Quick Challenge Quiz" },
      { color: "purple", time: 4, title: "Review & Next Steps" },
    ],
    homework: [
      { color: "green",  time: 3, title: "Homework Review" },
      { color: "blue",   time: 7, title: "Explain Difficult Parts" },
      { color: "blue",   time: 5, title: "Solve Together" },
      { color: "blue",   time: 3, title: "Fix Mistakes" },
      { color: "purple", time: 2, title: "Ready-to-Submit Check" },
    ],
    catch_up: [
      { color: "green",  time: 2, title: "What Was Missed" },
      { color: "blue",   time: 7, title: "Teach Key Concept" },
      { color: "blue",   time: 5, title: "Guided Examples" },
      { color: "blue",   time: 3, title: "Understanding Check" },
      { color: "purple", time: 3, title: "What Next" },
    ],
    revision: [
      { color: "green",  time: 3, title: "Topic Recap" },
      { color: "blue",   time: 6, title: "Quick Challenge Questions" },
      { color: "blue",   time: 5, title: "Learn From Mistakes" },
      { color: "blue",   time: 3, title: "Exam Confidence Boost" },
      { color: "purple", time: 3, title: "Wrap-Up" },
    ],
  },
  40: {
    learn_scratch: [
      { color: "green",  time: 5,  title: "Prior Knowledge Check",  desc: "Activate previous learning" },
      { color: "blue",   time: 10, title: "Step-by-Step Teaching",  desc: "Clear structured explanation" },
      { color: "blue",   time: 8,  title: "Worked Examples",        desc: '"I do"' },
      { color: "blue",   time: 8,  title: "Guided Practice",        desc: '"We do"' },
      { color: "blue",   time: 5,  title: "Independent Attempt",    desc: '"You do"' },
      { color: "purple", time: 4,  title: "Quick Recap & Reflection" },
    ],
    homework: [
      { color: "green",  time: 5,  title: "Homework Walkthrough" },
      { color: "blue",   time: 10, title: "Explain Difficult Concepts" },
      { color: "blue",   time: 10, title: "Guided Support" },
      { color: "blue",   time: 8,  title: "Similar Practice Questions" },
      { color: "purple", time: 7,  title: "Fix Mistakes + Confidence Check" },
    ],
    catch_up: [
      { color: "green",  time: 5,  title: "Missed Lesson Recap" },
      { color: "blue",   time: 12, title: "Teach Key Concepts" },
      { color: "blue",   time: 8,  title: "Guided Examples" },
      { color: "blue",   time: 8,  title: "Practice Together" },
      { color: "purple", time: 7,  title: "Understanding Check + Revisit Plan" },
    ],
    revision: [
      { color: "green",  time: 5,  title: "Topic Recap" },
      { color: "blue",   time: 10, title: "Practice Questions" },
      { color: "blue",   time: 8,  title: "Correct Mistakes" },
      { color: "blue",   time: 8,  title: "Timed Challenge" },
      { color: "purple", time: 9,  title: "Exam Strategy + Summary" },
    ],
  },
  60: {
    learn_scratch: [
      { color: "green",  time: 5,  title: "Prior Knowledge Activation" },
      { color: "blue",   time: 15, title: "Guided Teaching" },
      { color: "blue",   time: 10, title: "Multiple Worked Examples" },
      { color: "blue",   time: 10, title: "Scaffolded Practice" },
      { color: "blue",   time: 8,  title: "Independent Questions" },
      { color: "blue",   time: 5,  title: "Common Mistakes Review" },
      { color: "blue",   time: 4,  title: "Quiz Understanding" },
      { color: "purple", time: 3,  title: "Summary & Next Steps" },
    ],
    homework: [
      { color: "green",  time: 5,  title: "Homework Review" },
      { color: "blue",   time: 15, title: "Full Guided Walkthrough" },
      { color: "blue",   time: 10, title: "Difficult Areas Explained" },
      { color: "blue",   time: 10, title: "Practice Similar Questions" },
      { color: "blue",   time: 8,  title: "Independent Confidence Check" },
      { color: "purple", time: 12, title: "Final Review & Feedback" },
    ],
    catch_up: [
      { color: "green",  time: 5,  title: "Missed Lesson Recap" },
      { color: "blue",   time: 15, title: "Teach Missing Concepts" },
      { color: "blue",   time: 10, title: "Interactive Explanation" },
      { color: "blue",   time: 10, title: "Guided Examples" },
      { color: "blue",   time: 7,  title: "Practice Questions" },
      { color: "purple", time: 13, title: "Understanding Quiz + Summary" },
    ],
    revision: [
      { color: "green",  time: 5,  title: "Topic Recap" },
      { color: "blue",   time: 12, title: "Guided Exam Questions" },
      { color: "blue",   time: 10, title: "Mistake Feedback" },
      { color: "blue",   time: 10, title: "Harder Challenge Questions" },
      { color: "blue",   time: 8,  title: "Exam Strategy + Timed Retrieval" },
      { color: "purple", time: 15, title: "Confidence Check & Summary" },
    ],
  },
  90: {
    learn_scratch: [
      { color: "green",  time: 8,  title: "Prior Knowledge Activation" },
      { color: "blue",   time: 18, title: "Deep Teaching" },
      { color: "blue",   time: 12, title: "Worked Examples" },
      { color: "blue",   time: 12, title: "Practice Together" },
      { color: "yellow", time: 5,  title: "Brain Break / Reset" },
      { color: "blue",   time: 12, title: "Independent Challenge" },
      { color: "blue",   time: 10, title: "Quiz Assessment" },
      { color: "purple", time: 13, title: "Reflection & Mastery Review" },
    ],
    homework: [
      { color: "green",  time: 8,  title: "Homework Review" },
      { color: "blue",   time: 18, title: "Deep Explanation" },
      { color: "blue",   time: 12, title: "Practice Similar Questions" },
      { color: "yellow", time: 5,  title: "Reset Break" },
      { color: "blue",   time: 15, title: "Independent Attempt" },
      { color: "blue",   time: 10, title: "Tutor Feedback" },
      { color: "purple", time: 22, title: "Final Review & Confidence Check" },
    ],
    catch_up: [
      { color: "green",  time: 8,  title: "Lesson Recovery" },
      { color: "blue",   time: 20, title: "Guided Teaching" },
      { color: "blue",   time: 12, title: "Visual Explanation" },
      { color: "blue",   time: 10, title: "Practice Together" },
      { color: "yellow", time: 5,  title: "Break" },
      { color: "blue",   time: 15, title: "Independent Confidence Building" },
      { color: "purple", time: 20, title: "Quiz + What Next" },
    ],
    revision: [
      { color: "green",  time: 8,  title: "Full Topic Recap" },
      { color: "blue",   time: 18, title: "Exam-Style Questions" },
      { color: "blue",   time: 12, title: "Marking & Feedback" },
      { color: "yellow", time: 5,  title: "Break" },
      { color: "blue",   time: 15, title: "Harder Challenge Questions" },
      { color: "blue",   time: 12, title: "Timed Practice" },
      { color: "purple", time: 20, title: "Exam Strategy + Final Confidence Review" },
    ],
  },
};

function getPreviewSteps(sessionType: string, durationMinutes: string): PlanStep[] {
  const goalId = sessionTypeToGoalId(sessionType);
  const dur = parseInt(durationMinutes, 10);
  const key = ([20, 40, 60, 90] as number[]).includes(dur) ? dur : 40;
  return LESSON_PLAN_DATA[key]?.[goalId] ?? LESSON_PLAN_DATA[40].learn_scratch;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BookSessionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isParent = user?.role === "parent";
  const isTeacher = user?.role === "teacher";

  const [students, setStudents] = useState<UserType[]>([]);
  const [teachers, setTeachers] = useState<UserType[]>([]);
  const [availability, setAvailability] = useState<{ used: number; limit: number } | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [studentKeyStage, setStudentKeyStage] = useState("");

  const [kbSubjects, setKbSubjects] = useState<string[]>([]);
  const [kbStages, setKbStages] = useState<string[]>([]);
  const [kbUnits, setKbUnits] = useState<Array<{ id: number; title: string; unit_name: string }>>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);

  const [form, setForm] = useState({
    student_id: "",
    teacher_id: isTeacher ? String(user?.id ?? "") : "",
    subject: "",
    key_stage: "",
    session_type: "Learn from Scratch",
    title: "",
    date: "",
    time: "",
    duration_minutes: "40",
    description: "",
    payment_amount: "",
    passcode: "",
    require_passcode: false,
  });
  const [learnMode, setLearnMode] = useState<"ai_recommended" | "slides" | "worksheet" | "quiz">("ai_recommended");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedStudent = students.find((s) => String(s.id) === form.student_id);
  const selectedTeacher = isTeacher
    ? { name: user?.name ?? "You" }
    : teachers.find((t) => String(t.id) === form.teacher_id);

  useEffect(() => {
    const load = async () => {
      try {
        const filtersPromise = lessonsApi.getAvailableFilters();
        if (isTeacher) {
          const [studentList, filters] = await Promise.all([
            teacherApi.getStudents() as Promise<UserType[]>,
            filtersPromise,
          ]);
          setStudents(studentList);
          setKbSubjects(filters.subjects);
          setKbStages(filters.key_stages);
        } else if (isParent) {
          const [studentList, teacherList, filters] = await Promise.all([
            parentApi.getStudents() as Promise<UserType[]>,
            appointmentsApi.getTeachers() as Promise<UserType[]>,
            filtersPromise,
          ]);
          setStudents(studentList);
          setTeachers(teacherList);
          setKbSubjects(filters.subjects);
          setKbStages(filters.key_stages);
        }
      } catch {}
    };
    load();
  }, [isTeacher, isParent]);

  useEffect(() => {
    if (!form.subject || !form.key_stage) {
      setKbUnits([]);
      setSelectedUnits([]);
      return;
    }
    lessonsApi
      .getUnits(form.subject, form.key_stage)
      .then((data) => { setKbUnits(data.units); setSelectedUnits([]); })
      .catch(() => setKbUnits([]));
  }, [form.subject, form.key_stage]);

  const toggleUnit = (unitName: string) => {
    setSelectedUnits((prev) =>
      prev.includes(unitName) ? prev.filter((u) => u !== unitName) : [...prev, unitName]
    );
  };

  const checkAvailability = async (studentId: number) => {
    if (!studentId) return;
    setLoadingAvailability(true);
    try {
      const data = (await appointmentsApi.checkAvailability(studentId)) as {
        used: number; limit: number;
        slots_used?: number; slots_remaining?: number; max_per_week?: number; key_stage?: string | null;
      };
      const used = data.used ?? data.slots_used ?? 0;
      const limit = data.limit ?? data.max_per_week ?? 0;
      if (typeof used === "number" && typeof limit === "number") {
        setAvailability({ used, limit });
      } else {
        setAvailability(null);
      }
      const ks = data.key_stage ?? "";
      setStudentKeyStage(ks);
      const available = getAvailableDurations(ks);
      setForm((f) => ({
        ...f,
        duration_minutes: available.includes(parseInt(f.duration_minutes)) ? f.duration_minutes : "40",
      }));
    } catch {
      setAvailability(null);
      setStudentKeyStage("");
    } finally {
      setLoadingAvailability(false);
    }
  };

  const handleStudentChange = (id: string) => {
    setForm((f) => ({ ...f, student_id: id }));
    if (id) checkAvailability(parseInt(id, 10));
    else { setAvailability(null); setStudentKeyStage(""); }
  };

  const handleSubmit = async () => {
    setError("");
    setSuccess("");

    if (!form.student_id || !form.teacher_id || !form.subject || !form.title || !form.date || !form.time) {
      setError("Please fill in all required fields.");
      return;
    }

    const scheduledAt = new Date(`${form.date}T${form.time}`).toISOString();
    setSubmitting(true);
    try {
      await appointmentsApi.book({
        student_id: parseInt(form.student_id, 10),
        teacher_id: parseInt(form.teacher_id, 10),
        subject: form.subject,
        key_stage: form.key_stage,
        title: form.title,
        scheduled_at: scheduledAt,
        duration_minutes: parseInt(form.duration_minutes, 10) || 60,
        description:
          [
            selectedUnits.length > 0 ? `Topics: ${selectedUnits.join(", ")}` : "",
            form.session_type ? `Session type: ${form.session_type}` : "",
            form.description || "",
          ].filter(Boolean).join("\n") || undefined,
        payment_amount: form.payment_amount ? parseFloat(form.payment_amount) : undefined,
        learn_mode: learnMode,
        passcode: form.require_passcode && form.passcode ? form.passcode : undefined,
      });
      setSuccess("Session booked successfully!");
      setTimeout(() => navigate("/appointments"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to book session.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = () => {
    if (!form.date || !form.time) return null;
    try {
      const d = new Date(`${form.date}T${form.time}`);
      return (
        d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) +
        " at " +
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      );
    } catch { return null; }
  };

  const summaryComplete = !!(form.student_id && form.subject && form.date && form.time);
  const previewSteps = getPreviewSteps(form.session_type, form.duration_minutes);
  const durConfig = SESSION_TYPE_DURATIONS.find((d) => d.value === form.duration_minutes);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg-primary)" }}>
      <Sidebar />

      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", height: "100%", display: "flex", flexDirection: "column" }}>
        <style>{`
          .bsp-two-col { display: flex; gap: 24px; padding: 24px 28px 32px; align-items: flex-start; }
          @media (max-width: 768px) {
            .bsp-two-col { flex-direction: column !important; padding: 16px 16px 120px !important; gap: 16px !important; }
            .bsp-right-col { display: none !important; }
          }
          .bsp-dur-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
          @media (max-width: 500px) { .bsp-dur-grid { grid-template-columns: 1fr; } }
          .bsp-dur-card {
            border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px;
            cursor: pointer; background: var(--bg-secondary, #fff); text-align: left;
            transition: border-color 0.15s, box-shadow 0.15s;
            position: relative; display: flex; flex-direction: column; gap: 4px;
            font-family: inherit;
          }
          .bsp-dur-card:hover:not(:disabled) { border-color: #1a73e8; box-shadow: 0 2px 8px rgba(26,115,232,0.12); }
          .bsp-dur-card.active { border-color: #1a73e8; background: #eff6ff; box-shadow: 0 2px 8px rgba(26,115,232,0.15); }
          .bsp-dur-card:disabled { opacity: 0.4; cursor: not-allowed; }
          .bsp-step-connector { width: 2px; height: 12px; background: #e2e8f0; margin: 0 auto; }
          .bsp-unit-chip {
            padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 600;
            cursor: pointer; transition: all 0.15s; font-family: inherit;
          }
        `}</style>

        {/* ── Hero banner ─────────────────────────────────────────────────── */}
        <div style={{
          background: "linear-gradient(135deg, #1a73e8 0%, #6366f1 60%, #8b5cf6 100%)",
          padding: "18px 28px",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          boxSizing: "border-box",
        }}>
          {/* Decorative circles */}
          <div style={{ position: "absolute", top: -40, left: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.07)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -30, left: 260, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)", pointerEvents: "none" }} />

          {/* Back + heading */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative", zIndex: 1 }}>
            <button
              onClick={() => navigate("/appointments")}
              style={{
                background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 8, padding: "7px 10px", color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit", backdropFilter: "blur(8px)",
              }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "0 0 4px", lineHeight: 1.2 }}>
                {isParent ? "Book a Session for Your Child" : "Schedule a Student Session"}
              </h1>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0 }}>
                {isParent
                  ? "Schedule an AI-powered tutoring session — your child joins at the set time."
                  : "Create a structured AI lesson for one of your students."}
              </p>
            </div>
          </div>

          {/* Duration pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 1, marginRight: 130 }}>
            <span style={chipStyle}>
              {durConfig?.emoji ?? "⭐"} {durConfig?.name ?? "Core Learning"} — {durConfig?.sublabel ?? "40 mins"}
            </span>
            <span style={chipStyle}>
              <Calendar size={12} style={{ display: "inline", marginRight: 4 }} />
              {form.date ? new Date(form.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "No date set"}
            </span>
          </div>

          {/* Robot */}
          <img
            src="/images/robotAI.png"
            alt=""
            style={{ position: "absolute", bottom: 0, right: 16, width: 110, pointerEvents: "none", zIndex: 1 }}
          />
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div className="bsp-two-col">

            {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>

              {/* STEP 1 — Participants */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>1</span>
                  <div>
                    <div style={s.stepTitle}>Who is this session for?</div>
                    <div style={s.stepSubtitle}>Select the student and tutor for this session.</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 0 }}>
                  {/* Student */}
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={s.label}>Student *</label>
                    <div style={{ position: "relative" }}>
                      <User size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
                      <select
                        value={form.student_id}
                        onChange={(e) => handleStudentChange(e.target.value)}
                        required
                        style={{ ...selectStyle, paddingLeft: 32 }}
                      >
                        <option value="">Select student</option>
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Teacher */}
                  {isParent ? (
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={s.label}>Teacher *</label>
                      <select
                        value={form.teacher_id}
                        onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}
                        required
                        style={selectStyle}
                      >
                        <option value="">Select teacher</option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={s.label}>Teacher</label>
                      <input
                        type="text"
                        value={user?.name ?? "You (teacher)"}
                        disabled
                        style={{ ...inputStyle, background: "var(--bg-tertiary)", cursor: "not-allowed", opacity: 0.7 }}
                      />
                    </div>
                  )}
                </div>

                {/* Availability badge */}
                {availability && !loadingAvailability && (
                  <div style={{
                    marginTop: 12, padding: "8px 12px", borderRadius: 8,
                    background: availability.used >= availability.limit ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
                    border: `1px solid ${availability.used >= availability.limit ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
                    fontSize: 12, fontWeight: 600,
                    color: availability.used >= availability.limit ? "#ef4444" : "#16a34a",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <Info size={13} />
                    Sessions used: {availability.used} / {availability.limit}
                    {availability.used >= availability.limit && " — limit reached"}
                  </div>
                )}
              </div>

              {/* STEP 2 — Session Details */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>2</span>
                  <div>
                    <div style={s.stepTitle}>What will this session cover?</div>
                    <div style={s.stepSubtitle}>Choose the subject, key stage, and session goal.</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={s.label}>Subject *</label>
                    <select
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value, key_stage: "", title: "" }))}
                      required
                      style={selectStyle}
                    >
                      <option value="">Select subject</option>
                      {kbSubjects.map((sub) => (
                        <option key={sub} value={sub}>{sub}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={s.label}>Key Stage / Year Group *</label>
                    <select
                      value={form.key_stage}
                      onChange={(e) => setForm((f) => ({ ...f, key_stage: e.target.value }))}
                      style={{ ...selectStyle, opacity: form.subject ? 1 : 0.5 }}
                      disabled={!form.subject}
                    >
                      <option value="">Select key stage</option>
                      {kbStages.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Session Goal compact cards */}
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>Session Goal</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 6 }}>
                    {SESSION_GOAL_OPTIONS.map((g) => {
                      const sel = form.session_type === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, session_type: g.id }))}
                          style={{
                            display: "flex", flexDirection: "column", alignItems: "center",
                            padding: "16px 10px 14px", gap: 8,
                            border: `2px solid ${sel ? "#1a73e8" : g.cardBorder}`,
                            borderRadius: 12,
                            background: sel ? "#eff6ff" : g.cardBg,
                            cursor: "pointer", textAlign: "center", fontFamily: "inherit",
                            position: "relative", transition: "all 0.15s",
                          }}
                        >
                          <div style={{
                            position: "absolute", top: 10, left: 10,
                            width: 16, height: 16, borderRadius: "50%",
                            border: `2px solid ${sel ? "#1a73e8" : g.color}`,
                            background: sel ? "#1a73e8" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s",
                          }}>
                            {sel && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                          </div>
                          <span style={{
                            width: 44, height: 44, borderRadius: 10,
                            background: g.bg, color: g.color,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            marginTop: 4, flexShrink: 0,
                          }}>
                            {g.icon}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: sel ? "#1a73e8" : "var(--text-primary)", lineHeight: 1.2 }}>
                            {g.label}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                            {g.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Learn Mode cards */}
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>How should we learn?</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 6 }}>
                    {LEARN_MODE_OPTIONS.map((m) => {
                      const sel = learnMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setLearnMode(m.id)}
                          style={{
                            display: "flex", flexDirection: "column", alignItems: "center",
                            padding: "16px 10px 14px", gap: 8,
                            border: `2px solid ${sel ? "#1a73e8" : m.cardBorder}`,
                            borderRadius: 12,
                            background: sel ? "#eff6ff" : m.cardBg,
                            cursor: "pointer", textAlign: "center", fontFamily: "inherit",
                            position: "relative", transition: "all 0.15s",
                          }}
                        >
                          <div style={{
                            position: "absolute", top: 10, left: 10,
                            width: 16, height: 16, borderRadius: "50%",
                            border: `2px solid ${sel ? "#1a73e8" : m.color}`,
                            background: sel ? "#1a73e8" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s",
                          }}>
                            {sel && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                          </div>
                          <span style={{
                            width: 44, height: 44, borderRadius: 10,
                            background: sel ? "rgba(26,115,232,0.12)" : m.iconBg,
                            color: sel ? "#1a73e8" : m.color,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            marginTop: 4, flexShrink: 0,
                          }}>
                            {m.icon}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: sel ? "#1a73e8" : "var(--text-primary)" }}>
                            {m.label}
                          </span>
                          {m.badge && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 6px", borderRadius: 99 }}>
                              {m.badge}
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{m.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Session title */}
                <div style={{ marginBottom: kbUnits.length > 0 ? 14 : 0 }}>
                  <label style={s.label}>Session Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Cell Structure Revision"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    required
                    style={inputStyle}
                  />
                </div>

                {/* Topics from KB */}
                {kbUnits.length > 0 && (
                  <div>
                    <label style={s.label}>
                      Topics / Units to Cover
                      {selectedUnits.length > 0 && (
                        <span style={{ fontWeight: 400, color: "#1a73e8", marginLeft: 6 }}>
                          {selectedUnits.length} selected
                        </span>
                      )}
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {kbUnits.map((unit) => {
                        const sel = selectedUnits.includes(unit.unit_name);
                        return (
                          <button
                            key={unit.id}
                            type="button"
                            className="bsp-unit-chip"
                            onClick={() => toggleUnit(unit.unit_name)}
                            style={{
                              border: `1.5px solid ${sel ? "#1a73e8" : "#e2e8f0"}`,
                              background: sel ? "rgba(26,115,232,0.1)" : "var(--bg-primary)",
                              color: sel ? "#1a73e8" : "var(--text-secondary)",
                            }}
                          >
                            {unit.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {form.subject && form.key_stage && kbUnits.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0 0" }}>
                    No KB documents for {form.subject} {form.key_stage} — AI will use general knowledge.
                  </p>
                )}
              </div>

              {/* STEP 3 — Schedule & Duration */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>3</span>
                  <div>
                    <div style={s.stepTitle}>When and how long?</div>
                    <div style={s.stepSubtitle}>Pick a date, time, and session duration.</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={s.label}>Date *</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={s.label}>Time *</label>
                    <input
                      type="time"
                      value={form.time}
                      onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                      required
                      style={inputStyle}
                    />
                  </div>
                  {isTeacher && (
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={s.label}>Payment amount (£)</label>
                      <input
                        type="number"
                        placeholder="e.g. 25.00"
                        value={form.payment_amount}
                        onChange={(e) => setForm((f) => ({ ...f, payment_amount: e.target.value }))}
                        min="0"
                        step="0.01"
                        style={inputStyle}
                      />
                    </div>
                  )}
                </div>

                {/* Duration cards */}
                <div>
                  <label style={s.label}>Session Duration</label>
                  <div className="bsp-dur-grid">
                    {SESSION_TYPE_DURATIONS.map((d) => {
                      const available = getAvailableDurations(studentKeyStage);
                      const isAvailable = !studentKeyStage || available.includes(parseInt(d.value));
                      const isSelected = form.duration_minutes === d.value;
                      return (
                        <button
                          key={d.value}
                          type="button"
                          className={`bsp-dur-card${isSelected ? " active" : ""}`}
                          disabled={!isAvailable}
                          onClick={() => isAvailable && setForm((f) => ({ ...f, duration_minutes: d.value }))}
                          title={!isAvailable ? `Not available for ${studentKeyStage}` : undefined}
                          style={{ opacity: isAvailable ? 1 : 0.45 }}
                        >
                          {d.recommended && isAvailable && (
                            <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 800, background: "#10b981", color: "#fff", padding: "2px 7px", borderRadius: 999, textTransform: "uppercase" }}>
                              Recommended
                            </span>
                          )}
                          {!isAvailable && (
                            <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 700, background: "#e2e8f0", color: "#64748b", padding: "2px 7px", borderRadius: 999, textTransform: "uppercase" }}>
                              Locked
                            </span>
                          )}
                          <span style={{ fontSize: 22, filter: isAvailable ? "none" : "grayscale(1)" }}>{d.emoji}</span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: isAvailable ? "#0f172a" : "#94a3b8" }}>{d.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: isAvailable ? "#1a73e8" : "#94a3b8" }}>{d.sublabel}</span>
                          <span style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>{d.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  {studentKeyStage && getAvailableDurations(studentKeyStage).length < 4 && (
                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
                      Showing sessions available for <strong>{studentKeyStage}</strong>. Locked options require a higher key stage.
                    </p>
                  )}
                  {form.student_id && !studentKeyStage && (
                    <p style={{ fontSize: 12, color: "#f59e0b", marginTop: 8 }}>
                      Student has no key stage set — all durations available. They can set it in Settings → Profile.
                    </p>
                  )}
                </div>
              </div>

              {/* STEP 4 — Additional Settings */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>4</span>
                  <div>
                    <div style={s.stepTitle}>Additional settings</div>
                    <div style={s.stepSubtitle}>Optional notes and passcode protection.</div>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={form.require_passcode}
                      onChange={(e) => setForm((f) => ({ ...f, require_passcode: e.target.checked }))}
                      style={{ width: 15, height: 15, accentColor: "#1a73e8", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                      Require passcode to join
                    </span>
                  </label>
                  {form.require_passcode && (
                    <input
                      type="text"
                      placeholder="e.g. ABC123"
                      value={form.passcode}
                      onChange={(e) => setForm((f) => ({ ...f, passcode: e.target.value.toUpperCase() }))}
                      maxLength={16}
                      style={{ ...inputStyle, letterSpacing: 3, width: 200, fontWeight: 700 }}
                    />
                  )}
                </div>

                <div>
                  <label style={s.label}>Notes for tutor (optional)</label>
                  <textarea
                    placeholder="Any context, key points, or specific areas to focus on..."
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    style={{
                      width: "100%", padding: "10px 12px",
                      background: "var(--bg-secondary)", border: "1px solid var(--border)",
                      borderRadius: 8, color: "var(--text-primary)", fontSize: 13,
                      resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* ── RIGHT SIDEBAR ─────────────────────────────────────────────── */}
            <div className="bsp-right-col" style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24, alignSelf: "flex-start" }}>

              {/* Session Preview card */}
              <div style={s.rightCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <LayoutGrid size={16} style={{ color: "#1a73e8", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Session Preview</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
                  Here's what this {durConfig?.sublabel ?? "40 min"} {form.session_type.toLowerCase()} session will look like.
                </p>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {previewSteps.map((step, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                          <span style={{
                            padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                            background: STEP_COLOR_HEX[step.color], color: "#fff", whiteSpace: "nowrap",
                          }}>
                            {step.time} min
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, paddingBottom: i < previewSteps.length - 1 ? 4 : 0 }}>
                          <p style={{ margin: "0 0 1px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                            {i + 1}. {step.title}
                          </p>
                          {step.desc && (
                            <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                              {step.desc}
                            </p>
                          )}
                        </div>
                      </div>
                      {i < previewSteps.length - 1 && (
                        <div className="bsp-step-connector" style={{ marginLeft: 21, marginTop: 4, marginBottom: 8 }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Session Summary card */}
              <div style={s.rightCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 14 }}>
                  <Calendar size={15} style={{ color: "#1a73e8" }} />
                  <span>Session Summary</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(
                    [
                      { label: "Student", value: selectedStudent?.name },
                      { label: "Teacher", value: selectedTeacher?.name },
                      { label: "Subject", value: form.subject || undefined },
                      { label: "Key Stage", value: form.key_stage || undefined },
                      { label: "Goal", value: form.session_type || undefined },
                      { label: "Topics", value: selectedUnits.length > 0 ? selectedUnits.join(", ") : undefined },
                      { label: "Date & Time", value: formatDateTime() ?? undefined },
                      { label: "Duration", value: form.duration_minutes ? `${form.duration_minutes} minutes` : undefined },
                      { label: "Passcode", value: form.require_passcode && form.passcode ? form.passcode : undefined },
                    ] as Array<{ label: string; value: string | undefined }>
                  ).map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                      <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
                      <span style={{ fontWeight: 600, color: value ? "var(--text-primary)" : "var(--text-muted)", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {value ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {!summaryComplete && (
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
                    Fill in the form to see your session summary.
                  </p>
                )}
              </div>

              {/* What happens next */}
              <div style={s.rightCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 14 }}>
                  <CheckCircle size={15} style={{ color: "#10b981" }} />
                  <span>What happens next?</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    "Session is created and confirmed",
                    "Student sees it in their dashboard",
                    "AI tutor prepares for the session",
                    "Join the session at the scheduled time",
                  ].map((step) => (
                    <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                      <CheckCircle size={13} style={{ color: "#10b981", flexShrink: 0, marginTop: 1 }} />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: "8px 10px", background: "rgba(26,115,232,0.06)", border: "1px solid rgba(26,115,232,0.15)", borderRadius: 7, fontSize: 11, color: "#1a73e8", display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>You can reschedule or cancel up to 2 hours before the session.</span>
                </div>
              </div>

              {/* Availability progress */}
              {availability && (
                <div style={s.rightCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 14 }}>
                    <BookOpen size={15} style={{ color: "#1a73e8" }} />
                    <span>Session Availability</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Sessions used</span>
                    <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{availability.used} / {availability.limit}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--bg-tertiary)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, (availability.used / availability.limit) * 100)}%`,
                      background: availability.used >= availability.limit ? "#ef4444" : "#1a73e8",
                      borderRadius: 999, transition: "width 0.3s",
                    }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Sticky bottom bar ──────────────────────────────────────────────── */}
        <div style={{
          position: "sticky", bottom: 0,
          background: "var(--bg-secondary)", borderTop: "1px solid #e2e8f0",
          padding: "14px 28px", display: "flex", justifyContent: "space-between",
          alignItems: "center", zIndex: 10, flexShrink: 0, gap: 12, flexWrap: "wrap",
        }}>
          {/* Left: status / error */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {error ? (
              <span style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>{error}</span>
            ) : success ? (
              <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>✓ {success}</span>
            ) : summaryComplete ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>✓ Ready to book!</span>
                {form.subject && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", background: "#eff6ff", borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#1a73e8" }}>
                    📚 {form.subject}
                  </span>
                )}
                {form.session_type && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", background: "#f0fdf4", borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#16a34a" }}>
                    🎯 {form.session_type}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", background: "#fff7ed", borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#ea580c" }}>
                  ⏱ {form.duration_minutes} min
                </span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Complete steps 1–3 to book the session.
              </span>
            )}
          </div>

          {/* Right: CTA */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "12px 24px",
                background: !submitting ? "#1a73e8" : "#94a3b8",
                color: "#fff", border: "none", borderRadius: 10,
                fontSize: 14, fontWeight: 700,
                cursor: !submitting ? "pointer" : "not-allowed",
                fontFamily: "inherit", transition: "background 0.15s", whiteSpace: "nowrap",
              }}
            >
              {submitting ? "Booking…" : (
                <>
                  <Calendar size={15} />
                  Confirm &amp; Book Session
                  <ChevronRight size={16} />
                </>
              )}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              🛡️ You can reschedule or cancel before the session starts.
            </span>
          </div>
        </div>

      </main>
    </div>
  );
}

// ── Chip style for hero ───────────────────────────────────────────────────────

const chipStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "#fff",
  background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.25)", borderRadius: 99,
  padding: "5px 12px", whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center",
};

// ── Form control helpers ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px",
  background: "var(--bg-primary)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--text-primary)", fontSize: 13,
  fontFamily: "inherit", boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: "pointer",
};

// ── Shared panel / step styles ────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  stepCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "20px 22px",
  },
  stepHeader: {
    display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18,
  },
  stepNum: {
    width: 28, height: 28, borderRadius: "50%",
    background: "#1a73e8", color: "#fff",
    fontSize: 13, fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, marginTop: 2,
  },
  stepTitle: {
    fontSize: 15, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.3,
  },
  stepSubtitle: {
    fontSize: 12, color: "var(--text-muted)", marginTop: 2,
  },
  label: {
    display: "block", fontSize: 13, fontWeight: 600,
    color: "var(--text-secondary)", marginBottom: 6,
  },
  rightCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "18px 20px",
  },
};
