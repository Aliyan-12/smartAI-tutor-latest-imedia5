import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Bot,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { gamificationApi, assignmentsApi, appointmentsApi, curriculumApi, settingsApi } from "../services/api";
import type { HubTopic } from "../services/api";
import type { HubSubject } from "../services/api";
import type { StudentProfile, MyAssignment } from "../types";
import { phasesFor, type PhaseKey } from "../lib/lessonPhases";

// ── Goal → session type mapping ─────────────────────────────────────────────

type GoalId = "learn_scratch" | "homework" | "catch_up" | "revision";
type LearnMode = "ai_recommended" | "slides" | "worksheet" | "quiz";

const SESSION_TYPE_CONFIG: Record<number, { emoji: string; label: string; sublabel: string; desc: string; recommended?: boolean }> = {
  20: { emoji: "⚡", label: "Quick Boost",   sublabel: "20 mins", desc: "Short focused support — homework, one concept, revision burst" },
  40: { emoji: "⭐", label: "Core Learning", sublabel: "40 mins", desc: "Best balance of focus, teaching and retention", recommended: true },
  60: { emoji: "🚀", label: "Deep Learning", sublabel: "1 hour",  desc: "Serious progress — GCSE/A-Level topics, major practice" },
  90: { emoji: "🏆", label: "Intensive",     sublabel: "90 mins", desc: "Exams and major catch-up — includes a brain break" },
};

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

// ── Goal × session-length rules ──────────────────────────────────────────────
// Not every goal fits every time slot (a 20-min "Learn from Scratch" can't teach a topic).
// This is INDEPENDENT of the key-stage gate above — a slot is offered only when BOTH allow it.
//   "full"    → normal, full lesson for that goal
//   "limited" → allowed but a reduced scope (a short note is shown, e.g. "Quiz only")
//   "blocked" → not allowed for this goal (disabled, with the reason on hover/aria)
type DurationRule = { state: "full" | "limited" | "blocked"; note?: string; reason?: string };

function goalDurationRule(goal: GoalId, mins: number): DurationRule {
  if (mins !== 20) return { state: "full" };   // 40/60/90 work for every goal
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

// Deep Learning (60) is the recommended length for learning a topic from scratch; the balanced
// Core Learning (40) is the default for the other goals.
function recommendedDuration(goal: GoalId): number {
  return goal === "learn_scratch" ? 60 : 40;
}

// A slot is offered when the key stage allows it AND the goal doesn't block it.
function isDurationAllowed(goal: GoalId, mins: number, studentKeyStage: string): boolean {
  return getAvailableDurations(studentKeyStage).includes(mins)
    && goalDurationRule(goal, mins).state !== "blocked";
}

function durationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins === 60) return "1 Hour";
  return `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ""}`.trim();
}

// ── Dynamic lesson preview ───────────────────────────────────────────────────

type StepColor = "green" | "blue" | "yellow" | "purple";

interface PlanStep {
  color: StepColor;
  time: number;
  title: string;
  desc?: string;
}

const STEP_COLOR_HEX: Record<StepColor, string> = {
  green:  "#22c55e",
  blue:   "#3b82f6",
  yellow: "#f59e0b",
  purple: "#8b5cf6",
};



// Wording per goal for each phase. The TIMES come from the shared budget — this only supplies
// the language, so a goal can read differently without ever misstating the lesson's shape.
const GOAL_PHASE_COPY: Record<GoalId, Record<PhaseKey, { title: string; desc: string }>> = {
  learn_scratch: {
    recap:    { title: "Quick Recap",           desc: "Warm up + check what you already know" },
    teach:    { title: "Learn the Topic",       desc: "Step-by-step teaching from the slides, with visuals" },
    practice: { title: "Guided Practice",       desc: "Work through it together, then try some yourself" },
    quiz:     { title: "Quick Quiz",            desc: "A short quiz to check it's all stuck" },
    review:   { title: "Review & Next Steps",   desc: "Recap + what to practise next" },
  },
  homework: {
    recap:    { title: "Homework Review",       desc: "Understand the task + spot the sticking points" },
    teach:    { title: "Explain the Hard Parts", desc: "Break the tricky concepts down simply" },
    practice: { title: "Solve It Together",     desc: "Step-by-step support, then you try" },
    quiz:     { title: "Quick Quiz",            desc: "Check you can now do it on your own" },
    review:   { title: "Ready-to-Submit Check", desc: "Fix mistakes + final confidence boost" },
  },
  catch_up: {
    recap:    { title: "Find the Gaps",         desc: "Check what was missed" },
    teach:    { title: "Missed Content",        desc: "Teach the parts you weren't there for" },
    practice: { title: "Practice to Catch Up",  desc: "Questions until it feels normal again" },
    quiz:     { title: "Quick Quiz",            desc: "Confirm you're back up to speed" },
    review:   { title: "Back on Track",         desc: "Recap + how to stay caught up" },
  },
  revision: {
    recap:    { title: "Quick Recall",          desc: "What do you remember?" },
    teach:    { title: "Key Concept Review",    desc: "Refresh the ideas that matter most" },
    practice: { title: "Exam-Style Questions",  desc: "Practise under exam conditions" },
    quiz:     { title: "Timed Quiz",            desc: "Test yourself against the clock" },
    review:   { title: "Mark & Improve",        desc: "Mark scheme + where to gain marks" },
  },
};

function getDynamicPreview(goal: GoalId, duration: number): PlanStep[] {
  // Built from the SHARED phase budget (lib/lessonPhases), which mirrors the server's
  // _PHASE_BUDGET. The old hand-written table drifted from the real plan — it promised a
  // 20-minute lesson 5 minutes of teaching when the server gives it none — and a student who
  // is shown a structure the tutor does not follow loses trust in the first two minutes.
  const copy = GOAL_PHASE_COPY[goal] ?? GOAL_PHASE_COPY.learn_scratch;
  const colour: Record<PhaseKey, StepColor> = {
    recap: "green", teach: "blue", practice: "blue", quiz: "yellow", review: "purple",
  };
  return phasesFor(duration).map((p) => ({
    color: colour[p.key], time: p.mins,
    title: copy[p.key].title, desc: copy[p.key].desc,
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
  // ── Form state ──────────────────────────────────────────────────────────
  const [subject, setSubject] = useState(
    locationState.subject ?? searchParams.get("subject") ?? ""
  );
  const [keyStage, setKeyStage] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  // Subtopic (Resource Hub "topic") within the chosen topic/unit — OPTIONAL. Offered only when a
  // SINGLE topic is selected (subtopics belong to one unit). Empty = start from the beginning.
  const [subtopicOptions, setSubtopicOptions] = useState<HubTopic[]>([]);
  const [selectedSubtopic, setSelectedSubtopic] = useState<string>("");
  const [goal, setGoal] = useState<GoalId>(locationState.goal ?? "learn_scratch");
  const [learnMode, setLearnMode] = useState<LearnMode>("ai_recommended");
  const [duration, setDuration] = useState<number>(40);
  const [studentKeyStage, setStudentKeyStage] = useState<string>("");
  const [extraDetails, setExtraDetails] = useState("");
  const [requirePasscode, setRequirePasscode] = useState(false);
  const [bookingPasscode, setBookingPasscode] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const topicDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Topic to auto-select once its units load (from a dashboard "Recommended" click).
  const pendingTopicRef = useRef<string | null>(
    locationState.topic ?? searchParams.get("topic") ?? null
  );

  // ── Curriculum data state (Resource Hub mirror) ──────────────────────────
  const [hubSubjects, setHubSubjects] = useState<HubSubject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [hubYears, setHubYears] = useState<string[]>([]);
  const [kbStages, setKbStages] = useState<string[]>([]);   // key stages
  const [kbUnits, setKbUnits] = useState<Array<{ id: number; title: string; unit_name: string; has_resources: boolean }>>([]);

  // ── Other data state ────────────────────────────────────────────────────
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [assignment, setAssignment] = useState<MyAssignment | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);

  // ── Submit state ────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────
  const canSubmit = subject.trim() !== "" && keyStage.trim() !== "" && selectedTopics.length > 0;
  // Selected units that have no teaching resources on the Hub (warning only —
  // the session can still start; the AI falls back to general knowledge).
  const topicsWithoutResources = selectedTopics.filter((t) => {
    const u = kbUnits.find((x) => x.unit_name === t);
    return u && !u.has_resources;
  });

  // Curriculum cascade (Resource Hub): KeyStage → Year → Subject → Unit/Topic.
  // 1. Key stages on mount.
  useEffect(() => {
    curriculumApi.getKeyStages()
      .then((data) => setKbStages(data.keystages ?? []))
      .catch(() => {});
  }, []);

  // 2. Year groups when the key stage changes.
  useEffect(() => {
    if (!keyStage) { setHubYears([]); return; }
    curriculumApi.getYears(keyStage)
      .then((data) => setHubYears(data.years ?? []))
      .catch(() => setHubYears([]));
  }, [keyStage]);

  // 3. Subjects only once BOTH key stage AND year group are chosen (strict cascade).
  useEffect(() => {
    if (!keyStage || !yearGroup) { setHubSubjects([]); setSubjectsLoading(false); return; }
    let active = true;
    setSubjectsLoading(true);
    curriculumApi.getSubjects(keyStage, yearGroup)
      .then((data) => { if (active) setHubSubjects(data.subjects ?? []); })
      .catch(() => { if (active) setHubSubjects([]); })
      .finally(() => { if (active) setSubjectsLoading(false); });
    return () => { active = false; };
  }, [keyStage, yearGroup]);

  // 4. Derive subjectId from the chosen subject name (covers prefilled modes too).
  useEffect(() => {
    if (subject && hubSubjects.length) {
      const match = hubSubjects.find((s) => s.name === subject);
      setSubjectId(match ? match.id : null);
    } else {
      setSubjectId(null);
    }
  }, [subject, hubSubjects]);

  // 5. Units (the "topics" picker) when the subject is resolved.
  useEffect(() => {
    if (!subjectId || !keyStage) {
      setKbUnits([]);
      setSelectedTopics([]);
      return;
    }
    curriculumApi.getUnits(subjectId, keyStage, yearGroup || undefined)
      .then((data) => {
        const units = (data.units ?? []).map((u) => ({ id: u.id, title: u.title, unit_name: u.title, has_resources: u.has_resources }));
        setKbUnits(units);
        // Auto-select a topic passed from the dashboard "Recommended" click (once).
        const pending = pendingTopicRef.current;
        if (pending) {
          const norm = (x: string) => x.trim().toLowerCase();
          const match =
            units.find((u) => norm(u.unit_name) === norm(pending) || norm(u.title) === norm(pending)) ??
            units.find((u) => norm(u.title).includes(norm(pending)) || norm(pending).includes(norm(u.title)));
          setSelectedTopics(match ? [match.unit_name] : []);
          pendingTopicRef.current = null;
        } else {
          setSelectedTopics([]);
        }
      })
      .catch(() => setKbUnits([]));
  }, [subjectId, keyStage, yearGroup]);

  // Load the subtopics for the chosen topic. Subtopics belong to ONE unit, so they're only
  // offered when EXACTLY ONE topic is selected; otherwise the picker is hidden and any previous
  // choice is cleared. A blank choice means "start from the beginning of the topic".
  useEffect(() => {
    if (selectedTopics.length !== 1) {
      setSubtopicOptions([]);
      setSelectedSubtopic("");
      return;
    }
    const unit = kbUnits.find((u) => u.unit_name === selectedTopics[0]);
    if (!unit) {
      setSubtopicOptions([]);
      setSelectedSubtopic("");
      return;
    }
    let cancelled = false;
    curriculumApi.getTopics(unit.id)
      .then((data) => {
        if (cancelled) return;
        setSubtopicOptions(data.topics ?? []);
        // Drop a stale subtopic that isn't in the new unit's list.
        setSelectedSubtopic((cur) => ((data.topics ?? []).some((t) => t.title === cur) ? cur : ""));
      })
      .catch(() => { if (!cancelled) setSubtopicOptions([]); });
    return () => { cancelled = true; };
  }, [selectedTopics, kbUnits]);

  // Close topic dropdown on outside click
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

  // Fetch gamification profile for stats bar
  useEffect(() => {
    gamificationApi
      .getProfile()
      .then((data) => {
        const p = data as StudentProfile;
        setProfile(p);
        if (p.key_stage) {
          setStudentKeyStage(p.key_stage);
          setKeyStage((cur) => cur || p.key_stage!);
          const available = getAvailableDurations(p.key_stage);
          setDuration(available.includes(40) ? 40 : available[0]);
        }
      })
      .catch(() => setProfile(null));
  }, []);

  // Key Stage + Year Group are the student's own (set in Settings → Profile). They
  // are pre-selected here and LOCKED — the two dropdowns are disabled on this page,
  // so the student can only change them from Settings → Profile.
  useEffect(() => {
    settingsApi.getLearningPreferences()
      .then((data) => {
        const prefs = data as { key_stage?: string | null; year_group?: string | null };
        if (prefs.key_stage) {
          setKeyStage(prefs.key_stage);
          setStudentKeyStage(prefs.key_stage);
          const available = getAvailableDurations(prefs.key_stage);
          setDuration((d) => (available.includes(d) ? d : available.includes(40) ? 40 : available[0]));
        }
        if (prefs.year_group) setYearGroup(prefs.year_group);
      })
      .catch(() => {});
  }, []);

  // Keep the chosen length valid for the chosen goal. Switching to a goal that blocks the
  // current slot (e.g. Learn from Scratch while 20 min is selected) snaps to that goal's
  // recommended length if it's available, otherwise the first allowed slot — so the form never
  // sits on a disabled combination.
  useEffect(() => {
    if (isDurationAllowed(goal, duration, studentKeyStage)) return;
    const rec = recommendedDuration(goal);
    if (isDurationAllowed(goal, rec, studentKeyStage)) {
      setDuration(rec);
      return;
    }
    const firstOk = [20, 40, 60, 90].find((m) => isDurationAllowed(goal, m, studentKeyStage));
    if (firstOk) setDuration(firstOk);
  }, [goal, duration, studentKeyStage]);

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

  // Reset topics on subject change (key stage is chosen earlier in the cascade)
  const handleSubjectChange = (val: string) => {
    setSubject(val);
    setSelectedTopics([]);
  };

  // Reset the downstream cascade when key stage / year group change
  const handleKeyStageChange = (val: string) => {
    setKeyStage(val);
    setYearGroup("");
    setSubject("");
    setSelectedTopics([]);
  };
  const handleYearGroupChange = (val: string) => {
    setYearGroup(val);
    setSubject("");
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

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setUploadedFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      const next = Array.from(files).filter(f => !existing.has(f.name + f.size));
      return [...prev, ...next];
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

  // ── Submit: create appointment then navigate to session ─────────────────
  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    setSubmitError(null);

    const sessionType = goalToSessionType(goal);
    const topicsStr = selectedTopics.join(", ");
    // Only a single-topic lesson can carry a subtopic (see the subtopic effect).
    const subtopic = selectedTopics.length === 1 ? selectedSubtopic.trim() : "";
    const titleStr = `${sessionType} - ${subject}: ${selectedTopics[0] ?? subject}`;
    const descParts = [
      `Topics: ${topicsStr}`,
      `Session type: ${sessionType}`,
      `Learning mode: ${learnMode}`,
    ];
    if (subtopic) descParts.push(`Subtopic: ${subtopic}`);
    if (yearGroup) descParts.push(`Year group: ${yearGroup}`);
    // The student's own words about what they're struggling with. Labelled so the tutor can
    // lift it out and treat it as the lesson's primary objective (see build_session_system_prompt).
    if (extraDetails.trim()) descParts.push(`Notes: ${extraDetails.trim()}`);

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
        subtopic: subtopic || undefined,
        learn_mode: learnMode,
        passcode: requirePasscode && bookingPasscode.trim() ? bookingPasscode.trim() : undefined,
      }) as { id: number };

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
    emoji: string;
    label: string;
    desc: string;
    color: string;
    iconBg: string;
  }[] = [
    {
      id: "learn_scratch",
      emoji: "🧠",
      label: "Learn from Scratch",
      desc: "I'm new to this topic",
      color: "#10b981",
      iconBg: "rgba(16,185,129,0.12)",
    },
    {
      id: "homework",
      emoji: "🎯",
      label: "Practice & Improve",
      desc: "Strengthen my skills",
      color: "#6366f1",
      iconBg: "rgba(99,102,241,0.12)",
    },
    {
      id: "catch_up",
      emoji: "↩️",
      label: "Catch Up",
      desc: "I missed a lesson or need to catch up",
      color: "#f59e0b",
      iconBg: "rgba(245,158,11,0.12)",
    },
    {
      id: "revision",
      emoji: "🎓",
      label: "Exam Revision",
      desc: "Prepare for a test or exam",
      color: "#ef4444",
      iconBg: "rgba(239,68,68,0.12)",
    },
  ];

  // ── Learn mode options ──────────────────────────────────────────────────
  const learnModeOptions: {
    id: LearnMode;
    emoji: string;
    label: string;
    desc: string;
    badge?: string;
    color: string;
    iconBg: string;
  }[] = [
    {
      id: "ai_recommended",
      emoji: "✨",
      label: "AI Recommended",
      desc: "Best lesson plan for this topic and your learning style.",
      badge: "Recommended",
      color: "#1a73e8",
      iconBg: "rgba(26,115,232,0.12)",
    },
    {
      id: "slides",
      emoji: "🖥️",
      label: "Learn with Slides",
      desc: "AI explains using guided slides",
      color: "#8b5cf6",
      iconBg: "rgba(139,92,246,0.12)",
    },
    {
      id: "worksheet",
      emoji: "📄",
      label: "Practice with Worksheet",
      desc: "Work through questions step-by-step",
      color: "#f97316",
      iconBg: "rgba(249,115,22,0.12)",
    },
    {
      id: "quiz",
      emoji: "🎯",
      label: "Quiz & Test Me",
      desc: "Test your knowledge with a quiz",
      color: "#14b8a6",
      iconBg: "rgba(20,184,166,0.12)",
    },
  ];

  // Derived sidebar data
  const topicLabel = selectedTopics[0] ?? subject;
  const previewSteps = getDynamicPreview(goal, duration);
  const focusItems = FOCUS_ITEMS[goal];
  const goalLabel = goalOptions.find((g) => g.id === goal)?.label ?? "";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#f8fafc" }}>
      <Sidebar />

      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", height: "100%", display: "flex", flexDirection: "column" }}>
        <style>{`
          @media (max-width: 768px) {
            .lsp-two-col { flex-direction: column !important; padding: 12px 12px 100px !important; gap: 12px !important; }
            .lsp-right-col { display: none !important; }
            .lsp-step1-row { flex-direction: column !important; }
            .lsp-header { padding: 12px 16px 10px !important; gap: 10px !important; }
            .lsp-header-title { font-size: 17px !important; }
            .lsp-header-sub { font-size: 12px !important; }
            .lsp-header-stats { gap: 12px !important; }
            .lsp-stat-divider { display: none !important; }
          }
          @media (max-width: 480px) {
            .lsp-header-stats { display: none !important; }
            .lsp-header { padding: 10px 14px 8px !important; }
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
          .lsp-two-col select:focus, .lsp-two-col input:focus { border-color: #1a73e8 !important; box-shadow: 0 0 0 3px rgba(26,115,232,0.12) !important; outline: none; }
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

        {/* ── Page header ─────────────────────────────────────────── */}
        <div className="lsp-header" style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "20px 32px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          gap: 16,
          flexWrap: "wrap",
        }}>
          {/* Left: title */}
          <div>
            <h1 className="lsp-header-title" style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 4px", lineHeight: 1.2 }}>
              Let's set up your lesson 👋
            </h1>
            <p className="lsp-header-sub" style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
              Your AI Tutor will personalise the lesson just for you.
            </p>
          </div>

          {/* Right: stat items */}
          <div className="lsp-header-stats" style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            {/* Session length */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 18 }}>⏱</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px" }}>Session Length</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{durationLabel(duration)}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>(+10 min leeway)</div>
              </div>
            </div>

            <div className="lsp-stat-divider" style={{ width: 1, height: 36, background: "#e2e8f0" }} />

            {/* Streak */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 18 }}>🔥</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px" }}>Day Streak</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{streak}</div>
              </div>
            </div>

            <div className="lsp-stat-divider" style={{ width: 1, height: 36, background: "#e2e8f0" }} />

            {/* XP */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#fefce8", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 18 }}>⭐</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px" }}>XP</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{xpTotal}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, background: "#f8fafc" }}>
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

                {/* Key Stage · Year Group · Subject · Topic — single row */}
                <div className="lsp-step1-row" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Key Stage — locked (set in Settings → Profile) */}
                  <div style={{ flex: 1, minWidth: 110 }}>
                    <label style={s.label} title="Set in Settings → Profile">
                      Key Stage <span style={{ fontWeight: 400, color: "#94a3b8" }}>🔒</span>
                    </label>
                    <div style={s.selectWrap}>
                      <select
                        style={{ ...s.select as React.CSSProperties, background: "#f8fafc", cursor: "not-allowed", color: "#475569" }}
                        value={keyStage}
                        onChange={(e) => handleKeyStageChange(e.target.value)}
                        disabled
                        title="Set in Settings → Profile"
                      >
                        <option value="">Set in your profile</option>
                        {kbStages.map((ks) => (
                          <option key={ks} value={ks}>{ks}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} style={s.selectArrow as React.CSSProperties} />
                    </div>
                  </div>

                  {/* Year Group — locked (set in Settings → Profile) */}
                  <div style={{ flex: 1, minWidth: 110 }}>
                    <label style={s.label} title="Set in Settings → Profile">
                      Year Group <span style={{ fontWeight: 400, color: "#94a3b8" }}>🔒</span>
                    </label>
                    <div style={s.selectWrap}>
                      <select
                        style={{ ...s.select as React.CSSProperties, background: "#f8fafc", cursor: "not-allowed", color: "#475569" }}
                        value={yearGroup}
                        onChange={(e) => handleYearGroupChange(e.target.value)}
                        disabled
                        title="Set in Settings → Profile"
                      >
                        <option value="">Set in your profile</option>
                        {/* Always include the locked value so it shows even before the
                            year list has finished loading. */}
                        {yearGroup && !hubYears.includes(yearGroup) && (
                          <option value={yearGroup}>{yearGroup}</option>
                        )}
                        {hubYears.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} style={s.selectArrow as React.CSSProperties} />
                    </div>
                  </div>

                  {/* Subject */}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={s.label}>Subject</label>
                    <div style={s.selectWrap}>
                      <select
                        style={{ ...s.select as React.CSSProperties, opacity: (yearGroup && hubSubjects.length > 0) ? 1 : 0.5 }}
                        value={subject}
                        onChange={(e) => handleSubjectChange(e.target.value)}
                        disabled={!yearGroup || subjectsLoading || hubSubjects.length === 0}
                      >
                        <option value="">
                          {!yearGroup
                            ? "Choose year group first"
                            : subjectsLoading
                              ? "Loading subjects…"
                              : hubSubjects.length === 0
                                ? "No subjects for this year group"
                                : "Select subject..."}
                        </option>
                        {hubSubjects.map((sub) => (
                          <option key={sub.id} value={sub.name}>{getSubjectEmoji(sub.name)} {sub.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} style={s.selectArrow as React.CSSProperties} />
                    </div>
                  </div>

                  {/* Topic — always visible, disabled until subject + key stage chosen */}
                  <div style={{ flex: 2, minWidth: 180 }}>
                    <label style={s.label}>
                      Topic
                      {selectedTopics.length > 0 && (
                        <span style={{ fontWeight: 400, color: "#1a73e8", marginLeft: 6 }}>
                          {selectedTopics.length} selected
                        </span>
                      )}
                    </label>
                    <div style={{ position: "relative" }} ref={topicDropdownRef}>
                      {/* Trigger button */}
                      <button
                        type="button"
                        disabled={!subject || !keyStage}
                        onClick={() => (subject && keyStage) && setTopicDropdownOpen(v => !v)}
                        style={{
                          width: "100%", padding: "10px 36px 10px 12px",
                          border: `1.5px solid ${topicDropdownOpen ? "#1a73e8" : "#e2e8f0"}`,
                          borderRadius: 8,
                          background: (!subject || !keyStage) ? "#f8fafc" : "#fff",
                          cursor: (!subject || !keyStage) ? "not-allowed" : "pointer",
                          opacity: (!subject || !keyStage) ? 0.6 : 1,
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          fontSize: 14,
                          color: selectedTopics.length > 0 ? "#0f172a" : "#94a3b8",
                          fontFamily: "inherit", textAlign: "left",
                          transition: "border-color 0.15s",
                          boxShadow: topicDropdownOpen ? "0 0 0 3px rgba(26,115,232,0.12)" : "none",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {!subject || !keyStage
                            ? "Select subject & key stage first"
                            : kbUnits.length === 0 && subject && keyStage
                              ? "No topics available"
                              : selectedTopics.length === 0
                                ? "Select topics..."
                                : `${selectedTopics.length} topic${selectedTopics.length > 1 ? "s" : ""} selected`}
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

                      {/* Dropdown panel */}
                      {topicDropdownOpen && kbUnits.length > 0 && (
                        <div style={{
                          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
                          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 10,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.1)", maxHeight: 240, overflowY: "auto",
                          padding: "4px 0",
                        }}>
                          {kbUnits.map((unit) => {
                            const sel = selectedTopics.includes(unit.unit_name);
                            return (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() => setSelectedTopics(prev =>
                                  prev.includes(unit.unit_name)
                                    ? prev.filter(t => t !== unit.unit_name)
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
                                  transition: "all 0.15s",
                                }}>
                                  {sel && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                </div>
                                <span style={{ fontSize: 13, color: sel ? "#1a73e8" : "#0f172a", fontWeight: sel ? 600 : 400, lineHeight: 1.3, flex: 1 }}>
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
                    </div>

                    {/* Selected topic chips — below the row */}
                    {selectedTopics.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {selectedTopics.map(topic => (
                          <span key={topic} style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "3px 6px 3px 10px",
                            background: "#eff6ff", borderRadius: 99,
                            border: "1px solid #bfdbfe", fontSize: 12, color: "#1a73e8", fontWeight: 600,
                          }}>
                            {kbUnits.find(u => u.unit_name === topic)?.title ?? topic}
                            <button
                              type="button"
                              onClick={() => setSelectedTopics(prev => prev.filter(t => t !== topic))}
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

                    {/* Subtopic (optional) — only when a SINGLE topic is chosen and it has
                        subtopics. Blank = start from the beginning of the topic. */}
                    {selectedTopics.length === 1 && subtopicOptions.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ ...s.label, display: "flex", alignItems: "center", gap: 6 }}>
                          Subtopic
                          <span style={{ fontWeight: 400, color: "#64748b" }}>· recommended, optional</span>
                        </label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={selectedSubtopic}
                            onChange={(e) => setSelectedSubtopic(e.target.value)}
                            style={{
                              width: "100%", padding: "10px 36px 10px 12px", appearance: "none",
                              border: `1.5px solid ${selectedSubtopic ? "#1a73e8" : "#e2e8f0"}`,
                              borderRadius: 8, background: "#fff", cursor: "pointer",
                              fontSize: 14, fontFamily: "inherit",
                              color: selectedSubtopic ? "#0f172a" : "#475569",
                            }}
                          >
                            <option value="">Start from the beginning of the topic</option>
                            {subtopicOptions.map((st) => (
                              <option key={st.id} value={st.title}>{st.title}</option>
                            ))}
                          </select>
                          <ChevronDown
                            size={15}
                            style={{
                              position: "absolute", right: 12, top: "50%",
                              transform: "translateY(-50%)", color: "#64748b", pointerEvents: "none",
                            }}
                          />
                        </div>
                        <p style={{ margin: "6px 2px 0", fontSize: 11.5, color: "#94a3b8", lineHeight: 1.4 }}>
                          Pick a subtopic to jump straight to it, or leave it to begin at the start of the topic.
                        </p>
                      </div>
                    )}

                    {/* Warning: selected unit(s) have no Resource Hub material.
                        The session can still start — the AI uses general knowledge. */}
                    {topicsWithoutResources.length > 0 && (
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8,
                        padding: "8px 10px", background: "#fffbeb",
                        border: "1px solid #fde68a", borderRadius: 8,
                      }}>
                        <span style={{ fontSize: 13, lineHeight: 1.4 }}>⚠️</span>
                        <span style={{ fontSize: 12, color: "#92400e", lineHeight: 1.4 }}>
                          No resources on the Hub yet for{" "}
                          <strong>
                            {topicsWithoutResources
                              .map((t) => kbUnits.find((u) => u.unit_name === t)?.title ?? t)
                              .join(", ")}
                          </strong>
                          . You can still start the session — your AI tutor will teach from its general knowledge.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

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
                    <div style={s.stepTitle}>What help do you need today?</div>
                    <div style={s.stepSubtitle}>Choose your goal.</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {goalOptions.map((g) => {
                    const sel = goal === g.id;
                    // Exam Revision isn't built yet — show it blurred + "Coming soon", not clickable.
                    const comingSoon = g.id === "revision";
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => { if (!comingSoon) setGoal(g.id); }}
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

              {/* STEP 3 — Duration */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>3</span>
                  <span style={s.stepTitle}>How long would you like your session to be?</span>
                </div>
                <div className="lsp-dur-grid">
                  {([20, 40, 60, 90] as number[]).map((mins) => {
                    const cfg = SESSION_TYPE_CONFIG[mins];
                    const ksAllows = getAvailableDurations(studentKeyStage).includes(mins);
                    const rule = goalDurationRule(goal, mins);
                    const isAvailable = ksAllows && rule.state !== "blocked";
                    const isRecommended = mins === recommendedDuration(goal) && isAvailable;
                    const reason = !ksAllows
                      ? "Available for GCSE/A-Level and above."
                      : rule.state === "blocked" ? rule.reason : undefined;
                    return (
                      <button
                        key={mins}
                        type="button"
                        className={`lsp-dur-card${duration === mins ? " active" : ""}`}
                        disabled={!isAvailable}
                        onClick={() => isAvailable && setDuration(mins)}
                        title={reason}
                        aria-label={reason ? `${cfg.label} — ${reason}` : cfg.label}
                      >
                        {isRecommended && <span className="lsp-dur-badge">Recommended</span>}
                        {isAvailable && rule.state === "limited" && rule.note && (
                          <span className="lsp-dur-badge" style={{ background: "#f59e0b" }}>{rule.note}</span>
                        )}
                        <span className="lsp-dur-emoji">{cfg.emoji}</span>
                        <span className="lsp-dur-label">{cfg.label}</span>
                        <span className="lsp-dur-sub">{cfg.sublabel}</span>
                        <span className="lsp-dur-desc">{cfg.desc}</span>
                        {!isAvailable && reason && (
                          <span className="lsp-dur-desc" style={{ color: "#ef4444", fontWeight: 600, marginTop: 4 }}>
                            {reason}
                          </span>
                        )}
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
                    <div style={s.stepTitle}>How would you like to learn?</div>
                    <div style={s.stepSubtitle}>Choose how you'd like your tutor to help. (optional)</div>
                  </div>
                </div>

                {/* The learn-mode picker isn't live yet — blur the whole window and mark it
                    "Coming soon" (non-interactive). The default learnMode still applies underneath. */}
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
                              filter: "blur(3px)", opacity: 0.7, pointerEvents: "none", userSelect: "none" }}>
                  {learnModeOptions.map((m) => {
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

              {/* STEP 5 — Upload materials — HIDDEN (not yet available). Kept in code so the
                  upload wiring stays intact; just not shown to students. */}
              <div style={{ ...s.stepCard, display: "none" }}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>5</span>
                  <div>
                    <div style={s.stepTitle}>Upload materials <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>(optional)</span></div>
                    <div style={s.stepSubtitle}>Share notes, worksheets, or any files with your AI Tutor.</div>
                  </div>
                </div>

                {/* Drop zone */}
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
                    transition: "border-color 0.15s, background 0.15s",
                    textAlign: "center",
                  }}
                >
                  <span style={{ fontSize: 32 }}>📁</span>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Drag &amp; drop files here</span>
                    <span style={{ fontSize: 13, color: "#64748b" }}> or </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1a73e8" }}>click to browse</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>
                    PDF, Word, PowerPoint, images — multiple files supported
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.txt"
                  style={{ display: "none" }}
                  onChange={e => handleFiles(e.target.files)}
                />

                {/* File list */}
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
                            fontSize: 18, lineHeight: 1, fontFamily: "inherit",
                            transition: "color 0.15s",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#94a3b8")}
                          title="Remove file"
                        >×</button>
                      </div>
                    ))}
                    <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
                      {uploadedFiles.length} file{uploadedFiles.length > 1 ? "s" : ""} ready — your AI Tutor will use these during the session.
                    </p>
                  </div>
                )}
              </div>

              {/* STEP 6 — Additional Settings (shown as step 5: Upload materials is hidden) */}
              <div style={s.stepCard}>
                <div style={s.stepHeader}>
                  <span style={s.stepNum as React.CSSProperties}>5</span>
                  <div>
                    <div style={s.stepTitle}>Additional settings</div>
                    <div style={s.stepSubtitle}>Optional details and session access settings.</div>
                  </div>
                </div>

                {/* Add more details accordion */}
                <button
                  type="button"
                  style={s.accordionBtn as React.CSSProperties}
                  onClick={() => setShowExtra((v) => !v)}
                >
                  <ChevronDown
                    size={14}
                    style={{ transform: showExtra ? "rotate(180deg)" : "none", transition: "transform 0.2s", marginRight: 6 }}
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
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={requirePasscode}
                      onChange={(e) => { setRequirePasscode(e.target.checked); if (!e.target.checked) setBookingPasscode(""); }}
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
                      style={{ ...(s.input as React.CSSProperties), letterSpacing: 3, width: 200, fontWeight: 700 }}
                    />
                  )}
                </div>
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
                            background: STEP_COLOR_HEX[step.color],
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

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // Layout
  twoCol: {
    display: "flex",
    gap: 24,
    padding: "24px 32px 32px",
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
    width: 320,
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
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    background: "#fff",
    color: "#0f172a",
    fontSize: 14,
    appearance: "none",
    cursor: "pointer",
    outline: "none",
    fontFamily: "inherit",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    transition: "border-color 0.15s, box-shadow 0.15s",
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
