import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, ArrowLeft, User, BookOpen,
  CheckCircle, Info, ChevronRight, LayoutGrid,
  ChevronDown,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { appointmentsApi, teacherApi, parentApi, curriculumApi } from "../services/api";
import type { HubSubject, HubTopic, Tutor } from "../services/api";
import TutorPickerPills from "../components/TutorPickerPills";
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
  { id: "Learn from Scratch", emoji: "🧠", label: "Learn from Scratch", desc: "I'm new to this topic",              color: "#10b981", iconBg: "rgba(16,185,129,0.12)" },
  { id: "Homework Help",      emoji: "🎯", label: "Practice & Improve", desc: "Strengthen my skills",               color: "#6366f1", iconBg: "rgba(99,102,241,0.12)"  },
  { id: "Catch Up",           emoji: "↩️", label: "Catch Up",           desc: "I missed a lesson or need to catch up", color: "#f59e0b", iconBg: "rgba(245,158,11,0.12)" },
  { id: "Revision",           emoji: "🎓", label: "Exam Revision",      desc: "Prepare for a test or exam",         color: "#ef4444", iconBg: "rgba(239,68,68,0.12)"  },
];

const LEARN_MODE_OPTIONS = [
  { id: "ai_recommended" as const, emoji: "✨", label: "AI Recommended",       desc: "Best plan for this topic",           badge: "Recommended", color: "#1a73e8", iconBg: "rgba(26,115,232,0.12)"  },
  { id: "slides"         as const, emoji: "🖥️", label: "Learn with Slides",    desc: "AI explains using guided slides",    color: "#8b5cf6", iconBg: "rgba(139,92,246,0.12)" },
  { id: "worksheet"      as const, emoji: "📄", label: "Practice Worksheet",   desc: "Work through questions step-by-step", color: "#f97316", iconBg: "rgba(249,115,22,0.12)" },
  { id: "quiz"           as const, emoji: "🎯", label: "Quiz & Test Me",       desc: "Test knowledge with a quiz",         color: "#14b8a6", iconBg: "rgba(20,184,166,0.12)" },
];

const SUBJECT_EMOJIS: Record<string, string> = {
  "Mathematics": "📐", "Maths": "📐",
  "English": "📖", "English Literature": "📖", "English Language": "📖",
  "Science": "🔬", "Combined Science": "🔬",
  "Biology": "🧬", "Chemistry": "⚗️", "Physics": "⚛️",
  "History": "🏛️", "Geography": "🌍",
  "Computer Science": "💻", "ICT": "💻",
  "Religious Studies": "🕊️", "RE": "🕊️",
  "French": "🇫🇷", "Spanish": "🇪🇸", "German": "🇩🇪",
  "Art & Design": "🎨", "Art": "🎨",
  "Music": "🎵", "Drama": "🎭",
  "Physical Education": "⚽", "PE": "⚽",
  "Business Studies": "💼", "Business": "💼",
  "Economics": "📊", "Psychology": "🧠", "Sociology": "👥",
};
function getSubjectEmoji(name: string): string {
  return SUBJECT_EMOJIS[name] ?? "📚";
}

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

// ── Goal × session-length rules (mirrors LessonSetupPage) ────────────────────
// A slot is offered only when BOTH the key stage allows it AND the goal doesn't
// block it. A 20-min slot can't teach a topic from scratch, so it's blocked for
// "Learn from Scratch" and reduced-scope for the others.
type DurationRule = { state: "full" | "limited" | "blocked"; note?: string; reason?: string };

function goalDurationRule(goal: GoalId, mins: number): DurationRule {
  if (mins !== 20) return { state: "full" };  // 40/60/90 work for every goal
  switch (goal) {
    case "learn_scratch":
      return { state: "blocked", reason: "Learn from Scratch needs at least a 40-minute lesson to teach a topic properly." };
    case "homework":   // Practice & Improve
      return { state: "limited", note: "Quiz only" };
    case "catch_up":
      return { state: "limited", note: "Quick recap" };
    default:           // Exam Revision
      return { state: "full" };
  }
}

// Deep Learning (60) suits learning from scratch; the balanced Core Learning (40)
// is the default for the other goals.
function recommendedDuration(goal: GoalId): number {
  return goal === "learn_scratch" ? 60 : 40;
}

// A slot is offered when the key stage allows it AND the goal doesn't block it.
function isDurationAllowed(goal: GoalId, mins: number, studentKeyStage: string): boolean {
  return getAvailableDurations(studentKeyStage).includes(mins)
    && goalDurationRule(goal, mins).state !== "blocked";
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
  // Both parent and teacher pick an existing student, so the curriculum key stage +
  // year group are driven by (and locked to) that student's profile.
  const autoCurriculum = isParent || isTeacher;

  const [students, setStudents] = useState<UserType[]>([]);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [teachers, setTeachers] = useState<UserType[]>([]);
  const [availability, setAvailability] = useState<{ used: number; limit: number } | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [studentKeyStage, setStudentKeyStage] = useState("");

  // Curriculum sourced from the Resource Hub mirror (KS → Year → Subject → Unit).
  const [hubSubjects, setHubSubjects] = useState<HubSubject[]>([]);
  const [hubYears, setHubYears] = useState<string[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [kbStages, setKbStages] = useState<string[]>([]);
  const [kbUnits, setKbUnits] = useState<Array<{ id: number; title: string; unit_name: string; has_resources: boolean }>>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [subtopicOptions, setSubtopicOptions] = useState<HubTopic[]>([]);
  const [selectedSubtopic, setSelectedSubtopic] = useState<string>("");
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [tutorId, setTutorId] = useState<string>(() => localStorage.getItem("preferredTutor") || "aria");

  const [form, setForm] = useState({
    student_id: "",
    teacher_id: isTeacher ? String(user?.id ?? "") : "",
    subject: "",
    key_stage: "",
    year_group: "",
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
  const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const topicDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [success, setSuccess] = useState("");

  const selectedStudent = students.find((s) => String(s.id) === form.student_id);

  useEffect(() => {
    const load = async () => {
      try {
        const ksPromise = curriculumApi.getKeyStages();
        if (isTeacher) {
          const [studentList, ks] = await Promise.all([
            teacherApi.getStudents() as Promise<UserType[]>,
            ksPromise,
          ]);
          setStudents(studentList);
          setKbStages(ks.keystages ?? []);
        } else if (isParent) {
          const [studentList, teacherList, ks] = await Promise.all([
            parentApi.getStudents() as Promise<UserType[]>,
            appointmentsApi.getTeachers() as Promise<UserType[]>,
            ksPromise,
          ]);
          setStudents(studentList);
          setTeachers(teacherList);
          setKbStages(ks.keystages ?? []);
          // The teacher picker was removed from the form — auto-assign the parent's
          // first available teacher so the booking still has a valid teacher_id.
          if (teacherList.length > 0) {
            setForm((f) => (f.teacher_id ? f : { ...f, teacher_id: String(teacherList[0].id) }));
          }
        }
      } catch {
        // ignore — the empty-state / validation handles a failed/empty load
      } finally {
        setStudentsLoaded(true);
      }
    };
    load();
  }, [isTeacher, isParent]);

  // Curriculum cascade (Resource Hub): KeyStage → Year → Subject → Unit/Topic.
  // Year groups when the key stage changes.
  useEffect(() => {
    if (!form.key_stage) { setHubYears([]); return; }
    curriculumApi.getYears(form.key_stage)
      .then((data) => setHubYears(data.years ?? []))
      .catch(() => setHubYears([]));
  }, [form.key_stage]);

  // Subjects once BOTH key stage AND year group are chosen.
  useEffect(() => {
    if (!form.key_stage || !form.year_group) { setHubSubjects([]); return; }
    curriculumApi.getSubjects(form.key_stage, form.year_group)
      .then((data) => setHubSubjects(data.subjects ?? []))
      .catch(() => setHubSubjects([]));
  }, [form.key_stage, form.year_group]);

  // AI tutor catalogue (voice personas) — keep the remembered choice if still valid.
  useEffect(() => {
    curriculumApi.getTutors()
      .then((r) => {
        setTutors(r.tutors || []);
        setTutorId((cur) => (r.tutors?.some((t) => t.id === cur) ? cur : (r.default || "aria")));
      })
      .catch(() => {});
  }, []);
  useEffect(() => { localStorage.setItem("preferredTutor", tutorId); }, [tutorId]);

  // Subtopics for the chosen unit — only when EXACTLY ONE topic is selected (blank = whole topic).
  useEffect(() => {
    if (selectedUnits.length !== 1) { setSubtopicOptions([]); setSelectedSubtopic(""); return; }
    const unit = kbUnits.find((u) => u.unit_name === selectedUnits[0]);
    if (!unit) { setSubtopicOptions([]); setSelectedSubtopic(""); return; }
    let cancelled = false;
    curriculumApi.getTopics(unit.id)
      .then((data) => {
        if (cancelled) return;
        setSubtopicOptions(data.topics ?? []);
        setSelectedSubtopic((cur) => ((data.topics ?? []).some((t) => t.title === cur) ? cur : ""));
      })
      .catch(() => { if (!cancelled) setSubtopicOptions([]); });
    return () => { cancelled = true; };
  }, [selectedUnits, kbUnits]);

  // Resolve subjectId from the chosen subject name.
  useEffect(() => {
    if (form.subject && hubSubjects.length) {
      const m = hubSubjects.find((s) => s.name === form.subject);
      setSubjectId(m ? m.id : null);
    } else {
      setSubjectId(null);
    }
  }, [form.subject, hubSubjects]);

  // Units (the "topics" picker) once the subject is resolved.
  useEffect(() => {
    if (!subjectId || !form.key_stage) {
      setKbUnits([]);
      setSelectedUnits([]);
      return;
    }
    curriculumApi.getUnits(subjectId, form.key_stage, form.year_group || undefined)
      .then((data) => {
        setKbUnits((data.units ?? []).map((u) => ({ id: u.id, title: u.title, unit_name: u.title, has_resources: u.has_resources })));
        setSelectedUnits([]);
      })
      .catch(() => setKbUnits([]));
  }, [subjectId, form.key_stage, form.year_group]);

  // Auto-derive the session title from subject + topic/subtopic (the manual title
  // field was removed to mirror the student lesson-setup flow).
  useEffect(() => {
    const topicLabel = selectedSubtopic
      || (selectedUnits.length === 1
        ? (kbUnits.find((u) => u.unit_name === selectedUnits[0])?.title ?? selectedUnits[0])
        : selectedUnits.length > 1
          ? `${selectedUnits.length} topics`
          : "");
    const derived = [form.subject, topicLabel].filter(Boolean).join(" — ");
    setForm((f) => (f.title === derived ? f : { ...f, title: derived }));
  }, [form.subject, selectedUnits, selectedSubtopic, kbUnits]);

  // Keep the chosen length valid for the chosen goal + key stage (mirrors LessonSetupPage).
  // Switching to a goal that blocks the current slot snaps to that goal's recommended length
  // (or the first allowed one), so the form never sits on a disabled combination.
  useEffect(() => {
    const goalId = sessionTypeToGoalId(form.session_type);
    const mins = parseInt(form.duration_minutes);
    if (isDurationAllowed(goalId, mins, studentKeyStage)) return;
    const rec = recommendedDuration(goalId);
    if (isDurationAllowed(goalId, rec, studentKeyStage)) {
      setForm((f) => ({ ...f, duration_minutes: String(rec) }));
      return;
    }
    const firstOk = [20, 40, 60, 90].find((m) => isDurationAllowed(goalId, m, studentKeyStage));
    if (firstOk) setForm((f) => ({ ...f, duration_minutes: String(firstOk) }));
  }, [form.session_type, form.duration_minutes, studentKeyStage]);

  useEffect(() => {
    if (!topicDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (topicDropdownRef.current && !topicDropdownRef.current.contains(e.target as Node)) {
        setTopicDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [topicDropdownOpen]);

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
        slots_used?: number; slots_remaining?: number; max_per_week?: number;
        key_stage?: string | null; year_group?: string | null;
      };
      const used = data.used ?? data.slots_used ?? 0;
      const limit = data.limit ?? data.max_per_week ?? 0;
      if (typeof used === "number" && typeof limit === "number") {
        setAvailability({ used, limit });
      } else {
        setAvailability(null);
      }
      const ks = data.key_stage ?? "";
      const yg = data.year_group ?? "";
      setStudentKeyStage(ks);
      const available = getAvailableDurations(ks);
      setForm((f) => ({
        ...f,
        // Key stage + year group follow the chosen student and are locked to their
        // profile for both parent and teacher — always override, and reset the subject
        // since a different student means a different curriculum.
        key_stage: autoCurriculum ? ks : (f.key_stage || ks),
        year_group: autoCurriculum ? yg : (f.year_group || yg),
        ...(autoCurriculum ? { subject: "", title: "" } : {}),
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

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setUploadedFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...Array.from(files).filter(f => !existing.has(f.name + f.size))];
    });
  };
  const removeFile = (idx: number) => setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  const fileIcon = (type: string) => {
    if (type.includes("pdf")) return "📄";
    if (type.includes("word") || type.includes("document")) return "📝";
    if (type.includes("presentation") || type.includes("powerpoint")) return "📊";
    if (type.includes("image")) return "🖼️";
    return "📎";
  };
  const fmtSize = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

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
            form.year_group ? `Year group: ${form.year_group}` : "",
            selectedSubtopic ? `Subtopic: ${selectedSubtopic}` : "",
            tutorId ? `Tutor: ${tutorId}` : "",
            form.description ? `Notes: ${form.description}` : "",
          ].filter(Boolean).join("\n") || undefined,
        subtopic: selectedSubtopic || undefined,
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
  // Selected units with no teaching resources on the Hub (warning only — the
  // session can still be booked; the AI falls back to general knowledge).
  const unitsWithoutResources = selectedUnits.filter((u) => {
    const unit = kbUnits.find((x) => x.unit_name === u);
    return unit && !unit.has_resources;
  });

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#f8fafc" }}>
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
          .bsp-two-col select:focus, .bsp-two-col input:focus { border-color: #1a73e8 !important; box-shadow: 0 0 0 3px rgba(26,115,232,0.12) !important; outline: none; }
        `}</style>

        {/* ── Page header ─────────────────────────────────────────── */}
        <div style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "18px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          gap: 16,
          flexWrap: "wrap",
        }}>
          {/* Left: back + title */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={() => navigate("/appointments")}
              style={{
                background: "#f1f5f9", border: "1px solid #e2e8f0",
                borderRadius: 8, padding: "7px 12px", color: "#475569",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 3px", lineHeight: 1.2 }}>
                {isParent ? "Book a Session for Your Child 👨‍👩‍👧" : "Schedule a Student Session 📅"}
              </h1>
              <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                {isParent
                  ? "Schedule an AI-powered tutoring session — your child joins at the set time."
                  : "Create a structured AI lesson for one of your students."}
              </p>
            </div>
          </div>

          {/* Right: duration + date stat */}
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 18 }}>⏱</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px" }}>Duration</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{durConfig?.sublabel ?? "40 mins"}</div>
              </div>
            </div>
            <div style={{ width: 1, height: 36, background: "#e2e8f0" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Calendar size={18} style={{ color: "#16a34a" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px" }}>Date</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                  {form.date ? new Date(form.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Not set"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, background: "#f8fafc" }}>
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
                    <label style={s.label}>{isParent ? "Child *" : "Student *"}</label>
                    {autoCurriculum && studentsLoaded && students.length === 0 ? (
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "10px 12px", borderRadius: 8,
                        background: "#fffbeb", border: "1px solid #fde68a",
                        fontSize: 12.5, color: "#92400e", lineHeight: 1.45, fontWeight: 600,
                      }}>
                        <span style={{ fontSize: 14, lineHeight: 1.2 }}>⚠️</span>
                        <span>{isParent
                          ? "No children linked to your account. Ask your school admin to link your child before booking a session."
                          : "No students assigned to you yet. Ask your school admin to add students before booking a session."}</span>
                      </div>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <User size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
                        <select
                          value={form.student_id}
                          onChange={(e) => handleStudentChange(e.target.value)}
                          required
                          style={{ ...selectStyle, paddingLeft: 32 }}
                        >
                          <option value="">{isParent ? "Select child" : "Select student"}</option>
                          {students.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* AI tutor (voice persona) — drives the lesson's spoken voice. */}
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={s.label}>
                      AI tutor <span style={{ fontWeight: 400, color: "#94a3b8" }}>(voice — tap 🔊 to hear)</span>
                    </label>
                    <div style={{ marginTop: 4 }}>
                      <TutorPickerPills tutors={tutors} value={tutorId} onChange={setTutorId} />
                    </div>
                  </div>
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
                    <div style={s.stepTitle}>What do you want to learn?</div>
                    <div style={s.stepSubtitle}>Pick the key stage, subject and topic for this session.</div>
                  </div>
                </div>

                {/* Key Stage · Year Group — compact line (auto-filled + locked from the child for parents) */}
                <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 110 }}>
                    <label style={s.label}>
                      Key Stage *
                      {autoCurriculum && <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}>from {isParent ? "child" : "student"}</span>}
                    </label>
                    <select
                      value={form.key_stage}
                      onChange={(e) => setForm((f) => ({ ...f, key_stage: e.target.value, year_group: "", subject: "", title: "" }))}
                      required
                      disabled={autoCurriculum}
                      style={{ ...selectStyle, opacity: autoCurriculum ? 0.7 : 1, cursor: autoCurriculum ? "not-allowed" : undefined }}
                    >
                      <option value="">Select key stage</option>
                      {kbStages.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 110 }}>
                    <label style={s.label}>
                      Year Group *
                      {autoCurriculum && <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}>from {isParent ? "child" : "student"}</span>}
                    </label>
                    <select
                      value={form.year_group}
                      onChange={(e) => setForm((f) => ({ ...f, year_group: e.target.value, subject: "", title: "" }))}
                      style={{ ...selectStyle, opacity: (autoCurriculum || !form.key_stage) ? (autoCurriculum ? 0.7 : 0.5) : 1, cursor: autoCurriculum ? "not-allowed" : undefined }}
                      disabled={autoCurriculum || !form.key_stage}
                    >
                      <option value="">{form.key_stage ? "Select year group" : "Choose key stage first"}</option>
                      {hubYears.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Subject · Topic · Subtopic — one line, 25 / 25 / 50 */}
                <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={s.label}>Subject *</label>
                    <select
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      required
                      style={{ ...selectStyle, opacity: form.year_group ? 1 : 0.5 }}
                      disabled={!form.year_group}
                    >
                      <option value="">{form.year_group ? "Select subject" : "Choose year group first"}</option>
                      {hubSubjects.map((sub) => (
                        <option key={sub.id} value={sub.name}>{getSubjectEmoji(sub.name)} {sub.name}</option>
                      ))}
                    </select>
                  </div>
                  {/* Topic — always visible, disabled until subject + key stage chosen */}
                  <div style={{ flex: 1, minWidth: 180 }} ref={topicDropdownRef}>
                    <label style={s.label}>
                      Topic
                      {selectedUnits.length > 0 && (
                        <span style={{ fontWeight: 400, color: "#1a73e8", marginLeft: 6 }}>{selectedUnits.length} selected</span>
                      )}
                    </label>
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        disabled={!form.subject || !form.key_stage}
                        onClick={() => (form.subject && form.key_stage) && setTopicDropdownOpen(v => !v)}
                        style={{
                          width: "100%", padding: "10px 36px 10px 12px",
                          border: `1.5px solid ${topicDropdownOpen ? "#1a73e8" : "#e2e8f0"}`,
                          borderRadius: 8,
                          background: (!form.subject || !form.key_stage) ? "#f8fafc" : "#fff",
                          cursor: (!form.subject || !form.key_stage) ? "not-allowed" : "pointer",
                          opacity: (!form.subject || !form.key_stage) ? 0.6 : 1,
                          display: "flex", alignItems: "center",
                          fontSize: 14, color: selectedUnits.length > 0 ? "#0f172a" : "#94a3b8",
                          fontFamily: "inherit", textAlign: "left", transition: "border-color 0.15s",
                          boxShadow: topicDropdownOpen ? "0 0 0 3px rgba(26,115,232,0.12)" : "none",
                        }}
                      >
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {!form.subject || !form.key_stage
                            ? "Select subject & key stage first"
                            : kbUnits.length === 0
                              ? "No topics available"
                              : selectedUnits.length === 0
                                ? "Select topics..."
                                : `${selectedUnits.length} topic${selectedUnits.length > 1 ? "s" : ""} selected`}
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            position: "absolute", right: 12, top: "50%",
                            transform: `translateY(-50%) ${topicDropdownOpen ? "rotate(180deg)" : "rotate(0deg)"}`,
                            transition: "transform 0.2s", color: "#64748b", pointerEvents: "none",
                          }}
                        />
                      </button>
                      {topicDropdownOpen && kbUnits.length > 0 && (
                        <div style={{
                          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
                          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 10,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.1)", maxHeight: 240, overflowY: "auto",
                          padding: "4px 0",
                        }}>
                          {kbUnits.map((unit) => {
                            const sel = selectedUnits.includes(unit.unit_name);
                            return (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() => setSelectedUnits(prev =>
                                  prev.includes(unit.unit_name)
                                    ? prev.filter(u => u !== unit.unit_name)
                                    : [...prev, unit.unit_name]
                                )}
                                style={{
                                  display: "flex", alignItems: "center", gap: 10,
                                  width: "100%", padding: "9px 14px",
                                  background: sel ? "#eff6ff" : "transparent",
                                  border: "none", cursor: "pointer", textAlign: "left",
                                  fontFamily: "inherit", transition: "background 0.1s",
                                }}
                                onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; }}
                                onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                              >
                                <div style={{
                                  width: 17, height: 17, borderRadius: 4, flexShrink: 0,
                                  border: `2px solid ${sel ? "#1a73e8" : "#cbd5e1"}`,
                                  background: sel ? "#1a73e8" : "transparent",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                  {sel && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                </div>
                                <span style={{ fontSize: 13, color: sel ? "#1a73e8" : "#0f172a", fontWeight: sel ? 600 : 400, flex: 1 }}>
                                  {unit.title}
                                </span>
                                {!unit.has_resources && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 600, color: "#b45309",
                                    background: "#fef3c7", borderRadius: 6, padding: "2px 6px",
                                    flexShrink: 0, whiteSpace: "nowrap",
                                  }}>
                                    No Hub resources
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {selectedUnits.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                          {selectedUnits.map(unitName => (
                            <span key={unitName} style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "3px 6px 3px 10px",
                              background: "#eff6ff", borderRadius: 99,
                              border: "1px solid #bfdbfe", fontSize: 12, color: "#1a73e8", fontWeight: 600,
                            }}>
                              {kbUnits.find(u => u.unit_name === unitName)?.title ?? unitName}
                              <button
                                type="button"
                                onClick={() => setSelectedUnits(prev => prev.filter(u => u !== unitName))}
                                style={{
                                  background: "none", border: "none", cursor: "pointer",
                                  padding: "0 3px", color: "#93c5fd", fontSize: 16, lineHeight: 1,
                                  fontFamily: "inherit", display: "flex", alignItems: "center",
                                }}
                              >×</button>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Warning: selected unit(s) have no Resource Hub material.
                          The session can still be booked — the AI uses general knowledge. */}
                      {unitsWithoutResources.length > 0 && (
                        <div style={{
                          display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8,
                          padding: "8px 10px", background: "#fffbeb",
                          border: "1px solid #fde68a", borderRadius: 8,
                        }}>
                          <span style={{ fontSize: 13, lineHeight: 1.4 }}>⚠️</span>
                          <span style={{ fontSize: 12, color: "#92400e", lineHeight: 1.4 }}>
                            No resources on the Hub yet for{" "}
                            <strong>
                              {unitsWithoutResources
                                .map((t) => kbUnits.find((u) => u.unit_name === t)?.title ?? t)
                                .join(", ")}
                            </strong>
                            . You can still book the session — the AI tutor will teach from its general knowledge.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Subtopic — third column (50%). Disabled until exactly one topic with subtopics is chosen. */}
                  <div style={{ flex: 2, minWidth: 150 }}>
                    <label style={s.label}>Subtopic <span style={{ fontWeight: 400, color: "#94a3b8" }}>· optional</span></label>
                    <select
                      value={selectedSubtopic}
                      onChange={(e) => setSelectedSubtopic(e.target.value)}
                      disabled={!(selectedUnits.length === 1 && subtopicOptions.length > 0)}
                      style={{
                        ...selectStyle,
                        opacity: (selectedUnits.length === 1 && subtopicOptions.length > 0) ? 1 : 0.5,
                        cursor: (selectedUnits.length === 1 && subtopicOptions.length > 0) ? undefined : "not-allowed",
                      }}
                    >
                      <option value="">
                        {selectedUnits.length === 1 && subtopicOptions.length > 0
                          ? "Start from the beginning of the topic"
                          : "Pick one topic first"}
                      </option>
                      {subtopicOptions.map((st) => (
                        <option key={st.id} value={st.title}>{st.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>

              {/* STEP 3 — What help do you need today? */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>3</span>
                  <div>
                    <div style={s.stepTitle}>What help do you need today?</div>
                    <div style={s.stepSubtitle}>Choose the kind of support for this session.</div>
                  </div>
                </div>

                {/* Session Goal compact cards */}
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>Session Goal</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 6 }}>
                    {SESSION_GOAL_OPTIONS.map((g) => {
                      const sel = form.session_type === g.id;
                      // Exam Revision isn't built yet — show it blurred + "Coming soon", not clickable.
                      const comingSoon = g.id === "Revision";
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => { if (!comingSoon) setForm((f) => ({ ...f, session_type: g.id })); }}
                          aria-disabled={comingSoon}
                          style={{
                            display: "flex", flexDirection: "column", alignItems: "center",
                            padding: "16px 10px 14px", gap: 8,
                            border: `2px solid ${sel ? "#1a73e8" : "#e2e8f0"}`,
                            borderRadius: 12,
                            background: sel ? "#eff6ff" : "#fff",
                            cursor: comingSoon ? "not-allowed" : "pointer", textAlign: "center", fontFamily: "inherit",
                            position: "relative", transition: "all 0.15s",
                            boxShadow: sel ? "0 2px 8px rgba(26,115,232,0.12)" : "0 1px 3px rgba(0,0,0,0.06)",
                          }}
                        >
                          {comingSoon && (
                            <div style={{
                              position: "absolute", inset: 0, zIndex: 5, borderRadius: 12,
                              backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
                              background: "rgba(255,255,255,0.45)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <span style={{
                                fontSize: 11, fontWeight: 800, color: "#64748b", background: "#fff",
                                border: "1px solid #e2e8f0", padding: "4px 10px", borderRadius: 99,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                              }}>
                                Coming soon
                              </span>
                            </div>
                          )}
                          <div style={{
                            position: "absolute", top: 10, left: 10,
                            width: 16, height: 16, borderRadius: "50%",
                            border: `2px solid ${sel ? "#1a73e8" : "#cbd5e1"}`,
                            background: sel ? "#1a73e8" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s",
                          }}>
                            {sel && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                          </div>
                          <span style={{
                            width: 48, height: 48, borderRadius: 12,
                            background: sel ? "rgba(26,115,232,0.1)" : g.iconBg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            marginTop: 4, flexShrink: 0, fontSize: 24,
                          }}>
                            {g.emoji}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: sel ? "#1a73e8" : "#0f172a", lineHeight: 1.2 }}>
                            {g.label}
                          </span>
                          <span style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
                            {g.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* STEP 4 — Schedule & Duration */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>4</span>
                  <div>
                    <div style={s.stepTitle}>How long would you like your session to be?</div>
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
                      const mins = parseInt(d.value);
                      const goalId = sessionTypeToGoalId(form.session_type);
                      const ksAllows = getAvailableDurations(studentKeyStage).includes(mins);
                      const rule = goalDurationRule(goalId, mins);
                      const isAvailable = ksAllows && rule.state !== "blocked";
                      const isSelected = form.duration_minutes === d.value;
                      const isRecommended = mins === recommendedDuration(goalId) && isAvailable;
                      const reason = !ksAllows
                        ? "Available for GCSE/A-Level and above."
                        : rule.state === "blocked" ? rule.reason : undefined;
                      return (
                        <button
                          key={d.value}
                          type="button"
                          className={`bsp-dur-card${isSelected ? " active" : ""}`}
                          disabled={!isAvailable}
                          onClick={() => isAvailable && setForm((f) => ({ ...f, duration_minutes: d.value }))}
                          title={reason}
                          aria-label={reason ? `${d.name} — ${reason}` : d.name}
                          style={{ opacity: isAvailable ? 1 : 0.45 }}
                        >
                          {isRecommended && (
                            <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 800, background: "#10b981", color: "#fff", padding: "2px 7px", borderRadius: 999, textTransform: "uppercase" }}>
                              Recommended
                            </span>
                          )}
                          {isAvailable && rule.state === "limited" && rule.note && (
                            <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 800, background: "#f59e0b", color: "#fff", padding: "2px 7px", borderRadius: 999, textTransform: "uppercase" }}>
                              {rule.note}
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
                          {!isAvailable && reason && (
                            <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, marginTop: 4, lineHeight: 1.4 }}>
                              {reason}
                            </span>
                          )}
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

              {/* STEP 5 — How would you like to learn? */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>5</span>
                  <div>
                    <div style={s.stepTitle}>How would you like to learn?</div>
                    <div style={s.stepSubtitle}>Choose the teaching style for this session.</div>
                  </div>
                </div>

                {/* Learn Mode cards — the picker isn't live yet; blur the whole block + mark
                    "Coming soon" (non-interactive). The default learn mode still applies underneath. */}
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, zIndex: 5, borderRadius: 12,
                                display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{
                      fontSize: 13, fontWeight: 800, color: "#475569", background: "#fff",
                      border: "1px solid #e2e8f0", padding: "6px 14px", borderRadius: 99,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                    }}>
                      Coming soon
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 6,
                                filter: "blur(3px)", opacity: 0.7, pointerEvents: "none", userSelect: "none" }}>
                    {LEARN_MODE_OPTIONS.map((m) => {
                      const sel = learnMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setLearnMode(m.id)}
                          style={{
                            display: "flex", flexDirection: "column", alignItems: "center",
                            padding: "14px 10px 12px", gap: 6,
                            border: `2px solid ${sel ? "#1a73e8" : "#e2e8f0"}`,
                            borderRadius: 12,
                            background: sel ? "#eff6ff" : "#fff",
                            cursor: "pointer", textAlign: "center", fontFamily: "inherit",
                            position: "relative", transition: "all 0.15s",
                            boxShadow: sel ? "0 2px 8px rgba(26,115,232,0.12)" : "0 1px 3px rgba(0,0,0,0.06)",
                          }}
                        >
                          <div style={{
                            position: "absolute", top: 8, left: 8,
                            width: 14, height: 14, borderRadius: "50%",
                            border: `2px solid ${sel ? "#1a73e8" : "#cbd5e1"}`,
                            background: sel ? "#1a73e8" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {sel && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                          </div>
                          <span style={{
                            width: 48, height: 48, borderRadius: 12,
                            background: sel ? "rgba(26,115,232,0.1)" : m.iconBg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            marginTop: 4, flexShrink: 0, fontSize: 24,
                          }}>
                            {m.emoji}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: sel ? "#1a73e8" : "#0f172a" }}>
                            {m.label}
                          </span>
                          {m.badge && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 6px", borderRadius: 99 }}>
                              {m.badge}
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>{m.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Upload materials — hidden to mirror the student lesson-setup flow */}
              <div style={{ ...(s.stepCard as React.CSSProperties), display: "none" }}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>4</span>
                  <div>
                    <div style={s.stepTitle}>Upload materials <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>(optional)</span></div>
                    <div style={s.stepSubtitle}>Share notes, worksheets, or files with the AI Tutor for this session.</div>
                  </div>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                  style={{
                    border: `2px dashed ${isDragging ? "#1a73e8" : "#cbd5e1"}`,
                    borderRadius: 12, padding: "22px 20px",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                    cursor: "pointer", background: isDragging ? "#eff6ff" : "#fafbfc",
                    transition: "border-color 0.15s, background 0.15s", textAlign: "center",
                  }}
                >
                  <span style={{ fontSize: 32 }}>📁</span>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Drag &amp; drop files here</span>
                    <span style={{ fontSize: 13, color: "#64748b" }}> or </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1a73e8" }}>click to browse</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>PDF, Word, PowerPoint, images — multiple files supported</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.txt"
                  style={{ display: "none" }}
                  onChange={e => handleFiles(e.target.files)}
                />

                {uploadedFiles.length > 0 && (
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {uploadedFiles.map((file, idx) => (
                      <div key={idx} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", background: "#fff",
                        border: "1px solid #e2e8f0", borderRadius: 9,
                      }}>
                        <span style={{ fontSize: 22, flexShrink: 0 }}>{fileIcon(file.type)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {file.name}
                          </div>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{fmtSize(file.size)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "#94a3b8", padding: "4px 6px", borderRadius: 6,
                            fontSize: 18, lineHeight: 1, fontFamily: "inherit", transition: "color 0.15s",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#94a3b8")}
                          title="Remove file"
                        >×</button>
                      </div>
                    ))}
                    <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
                      {uploadedFiles.length} file{uploadedFiles.length > 1 ? "s" : ""} ready — AI Tutor will reference these during the session.
                    </p>
                  </div>
                )}
              </div>

              {/* STEP 6 — Additional Settings */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>6</span>
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
                      { label: "AI Tutor", value: tutors.find((t) => t.id === tutorId)?.name },
                      { label: "Key Stage", value: form.key_stage || undefined },
                      { label: "Year Group", value: form.year_group || undefined },
                      { label: "Subject", value: form.subject || undefined },
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

// ── Form control helpers ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px",
  background: "#fff", border: "1.5px solid #e2e8f0",
  borderRadius: 8, color: "#0f172a", fontSize: 13,
  fontFamily: "inherit", boxSizing: "border-box",
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: "pointer", appearance: "none" as const,
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
