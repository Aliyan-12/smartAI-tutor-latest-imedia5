import { useState, useEffect } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, LayoutGrid, Bot } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { gamificationApi, assignmentsApi, appointmentsApi, lessonsApi } from "../services/api";
import type { StudentProfile, MyAssignment } from "../types";

// ── Goal → session type mapping ─────────────────────────────────────────────

type GoalId = "learn" | "practice" | "test";

function goalToSessionType(goal: GoalId): string {
  if (goal === "learn") return "Topic Introduction";
  if (goal === "practice") return "General Tutoring";
  return "Exam Prep";
}

// ── Lesson preview steps (static, goal-aware) ───────────────────────────────

const PREVIEW_STEPS = [
  { num: 1, title: "Introduction", desc: "We'll explain the key concepts." },
  { num: 2, title: "Guided Practice", desc: "Work through examples together." },
  { num: 3, title: "Practice Questions", desc: "You'll try questions with help." },
  { num: 4, title: "Review & Recap", desc: "Quick summary and key takeaways." },
];

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
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [goal, setGoal] = useState<GoalId>(locationState.goal ?? "learn");
  const [duration, setDuration] = useState<30 | 60>(30);
  const [requirePasscode, setRequirePasscode] = useState(false);
  const [bookingPasscode, setBookingPasscode] = useState("");
  const [extraDetails, setExtraDetails] = useState("");
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
      .then((data) => setProfile(data as StudentProfile))
      .catch(() => setProfile(null));
  }, []);

  // Fetch pending assignments for "Recommended" panel
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
        passcode: requirePasscode && bookingPasscode.trim() ? bookingPasscode.trim() : undefined,
      }) as { id: number };

      navigate(`/session/${appointment.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to start lesson. Please try again.");
      setSubmitting(false);
    }
  };

  // ── XP level progress (rough: 100 XP per level) ─────────────────────────
  const xpTotal = profile?.xp_total ?? 0;
  const xpLevel = profile?.xp_level ?? 1;
  const streak = profile?.current_streak ?? 0;
  const xpInCurrentLevel = xpTotal % 100;
  const xpProgress = xpInCurrentLevel; // out of 100

  // ── Goal card options ────────────────────────────────────────────────────
  const goalOptions: { id: GoalId; emoji: string; label: string; desc: string }[] = [
    { id: "learn",    emoji: "🧠", label: "Learn from scratch",  desc: "I'm new to this topic"   },
    { id: "practice", emoji: "🎯", label: "Practice & improve",  desc: "Strengthen my skills"    },
    { id: "test",     emoji: "📋", label: "Prepare for test",    desc: "Exam or quiz prep"        },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg-primary)" }}>
      <Sidebar />

      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", height: "100%" }}>
        {/* ── Stats bar ─────────────────────────────────────────────────── */}
        <div style={s.statsBar}>
          <div style={{ flex: 1 }} />
          <div style={s.statsBadges}>
            <span style={s.statPill}>🔥 {streak} Day Streak</span>
            <span style={s.statPill}>⭐ {xpTotal} XP</span>
            <span style={s.levelBadge}>
              <span style={s.levelLabel}>Level {xpLevel}</span>
              <div style={s.levelTrack}>
                <div style={{ ...s.levelFill, width: `${xpProgress}%` }} />
              </div>
            </span>
          </div>
        </div>

        {/* ── Two-column layout ──────────────────────────────────────────── */}
        <div style={s.twoCol}>
          {/* ── Left: form ──────────────────────────────────────────────── */}
          <div style={s.leftCol}>
            {/* Page header */}
            <div style={s.pageHeader}>
              <h1 style={s.pageTitle}>Let's set up your lesson 👋</h1>
              <p style={s.pageSubtitle}>
                Tell us a few details and your AI tutor will take it from there.
              </p>
            </div>

            {/* ── Step 1: Subject / Key Stage / Topics ─────────────────── */}
            <div style={s.stepCard}>
              <div style={s.stepHeader}>
                <span style={s.stepNum}>1</span>
                <span style={s.stepTitle}>What do you want to learn?</span>
              </div>

              {/* Subject dropdown */}
              <div style={s.formGroup}>
                <label style={s.label}>Subject</label>
                <div style={s.selectWrap}>
                  <select
                    style={s.select}
                    value={subject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                  >
                    <option value="">Select a subject...</option>
                    {kbSubjects.map((sub) => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} style={s.selectArrow} />
                </div>
              </div>

              {/* Key Stage dropdown */}
              <div style={s.formGroup}>
                <label style={s.label}>Key Stage</label>
                <div style={s.selectWrap}>
                  <select
                    style={{ ...s.select, opacity: subject ? 1 : 0.5 }}
                    value={keyStage}
                    onChange={(e) => { setKeyStage(e.target.value); setSelectedTopics([]); }}
                    disabled={!subject}
                  >
                    <option value="">Select key stage...</option>
                    {kbStages.map((ks) => (
                      <option key={ks} value={ks}>{ks}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} style={s.selectArrow} />
                </div>
              </div>

              {/* Topics — multi-select chips from KB units */}
              {keyStage && (
                <div style={{ ...s.formGroup, marginBottom: 0 }}>
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {kbUnits.map((unit) => {
                        const sel = selectedTopics.includes(unit.unit_name);
                        return (
                          <button
                            key={unit.id}
                            type="button"
                            onClick={() => toggleTopic(unit.unit_name)}
                            style={{
                              padding: "5px 12px",
                              borderRadius: 99,
                              fontSize: 12,
                              fontWeight: 600,
                              border: `1.5px solid ${sel ? "#1a73e8" : "var(--border-color)"}`,
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
            </div>

            {/* ── Step 2: Goal ────────────────────────────────────────── */}
            <div style={s.stepCard}>
              <div style={s.stepHeader}>
                <span style={s.stepNum}>2</span>
                <span style={s.stepTitle}>What is your goal for this lesson?</span>
              </div>
              <div style={s.goalGrid}>
                {goalOptions.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    style={{
                      ...s.goalCard,
                      ...(goal === g.id ? s.goalCardSelected : {}),
                    }}
                    onClick={() => setGoal(g.id)}
                  >
                    <span style={s.goalEmoji}>{g.emoji}</span>
                    <span style={{
                      ...s.goalLabel,
                      color: goal === g.id ? "#1a73e8" : "var(--text-primary)",
                    }}>
                      {g.label}
                    </span>
                    <span style={s.goalDesc}>{g.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Step 3: Duration ────────────────────────────────────── */}
            <div style={s.stepCard}>
              <div style={s.stepHeader}>
                <span style={s.stepNum}>3</span>
                <span style={s.stepTitle}>How long would you like your session to be?</span>
              </div>
              <div style={s.durationRow}>
                <button
                  type="button"
                  style={{
                    ...s.durationPill,
                    ...(duration === 30 ? s.durationPillActive : {}),
                  }}
                  onClick={() => setDuration(30)}
                >
                  30 Minutes
                  <span style={s.recommendedBadge}>Recommended</span>
                </button>
                <button
                  type="button"
                  style={{
                    ...s.durationPill,
                    ...(duration === 60 ? s.durationPillActive : {}),
                  }}
                  onClick={() => setDuration(60)}
                >
                  1 Hour
                </button>
              </div>

              {/* Add more details accordion */}
              <button
                type="button"
                style={s.accordionBtn}
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
                  style={s.textarea}
                  value={extraDetails}
                  onChange={(e) => setExtraDetails(e.target.value)}
                  placeholder="Any extra context, materials, or specific areas to focus on..."
                  rows={4}
                />
              )}

              {/* Passcode — same pattern as BookSessionPage */}
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={requirePasscode}
                    onChange={(e) => {
                      setRequirePasscode(e.target.checked);
                      if (!e.target.checked) setBookingPasscode("");
                    }}
                    style={{ width: 15, height: 15, accentColor: "var(--accent, #1a73e8)", cursor: "pointer" }}
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
                      ...s.input,
                      letterSpacing: 3,
                      width: 200,
                      fontWeight: 700,
                    }}
                  />
                )}
              </div>
            </div>

            {/* ── Error message ─────────────────────────────────────── */}
            {submitError && (
              <div style={s.errorBox}>
                {submitError}
              </div>
            )}

            {/* ── CTA button ────────────────────────────────────────── */}
            <button
              type="button"
              style={{
                ...s.startBtn,
                ...(!canSubmit || submitting ? s.startBtnDisabled : {}),
              }}
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                "Starting your lesson..."
              ) : (
                <>
                  Start Lesson with Tutor
                  <ChevronRight size={18} style={{ marginLeft: 8 }} />
                </>
              )}
            </button>

            <p style={s.noteText}>
              🛡️ You can adjust anything during the lesson.
            </p>
          </div>

          {/* ── Right: panels ───────────────────────────────────────────── */}
          <div style={s.rightCol}>
            {/* Recommended for You */}
            <div style={s.rightCard}>
              <div style={s.rightCardHeader}>
                <span style={s.rightCardIcon}>💡</span>
                <span style={s.rightCardTitle}>Recommended for You</span>
              </div>

              {assignmentLoading ? (
                <div style={s.skeletonWrap}>
                  {([180, 140, 100] as number[]).map((w, i) => (
                    <div key={i} style={{ ...s.skeletonLine, width: w }} />
                  ))}
                </div>
              ) : assignment ? (
                <div style={s.assignmentCard}>
                  <div style={s.assignmentMeta}>
                    <span style={s.assignmentSubjectBadge}>{assignment.homework.subject}</span>
                    <span style={s.assignmentTypeBadge}>{assignment.homework.assignment_type}</span>
                  </div>
                  <p style={s.assignmentTitle}>{assignment.homework.title}</p>
                  {assignment.homework.topic && (
                    <p style={s.assignmentTopic}>Topic: {assignment.homework.topic}</p>
                  )}
                  <div style={s.assignmentActions}>
                    <button
                      type="button"
                      style={s.useBtn}
                      onClick={handleUseAssignment}
                    >
                      Use This
                    </button>
                    <button
                      type="button"
                      style={s.ignoreBtn}
                      onClick={() => setAssignment(null)}
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              ) : (
                <div style={s.noAssignment}>
                  <p style={s.noAssignmentText}>No assignments yet</p>
                </div>
              )}
            </div>

            {/* Lesson Preview */}
            <div style={s.rightCard}>
              <div style={s.rightCardHeader}>
                <LayoutGrid size={16} style={{ color: "#1a73e8", flexShrink: 0 }} />
                <span style={s.rightCardTitle}>Lesson Preview</span>
              </div>
              <div style={s.previewSteps}>
                {PREVIEW_STEPS.map((step) => (
                  <div key={step.num} style={s.previewStep}>
                    <div style={s.previewStepNum}>{step.num}</div>
                    <div style={s.previewStepInfo}>
                      <p style={s.previewStepTitle}>{step.title}</p>
                      <p style={s.previewStepDesc}>{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={s.previewFooter}>
                <Bot size={16} style={{ color: "#1a73e8", flexShrink: 0, marginTop: 1 }} />
                <p style={s.previewFooterText}>
                  AI will personalise the lesson based on your choices and progress.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // Stats bar
  statsBar: {
    display: "flex",
    alignItems: "center",
    padding: "14px 28px",
    borderBottom: "1px solid var(--border-color)",
    background: "var(--bg-secondary)",
  },
  statsBadges: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  statPill: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 99,
    padding: "5px 12px",
    whiteSpace: "nowrap",
  },
  levelBadge: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 99,
    padding: "5px 12px",
  },
  levelLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1a73e8",
    whiteSpace: "nowrap",
  },
  levelTrack: {
    width: 64,
    height: 6,
    borderRadius: 99,
    background: "var(--border-color)",
    overflow: "hidden",
  },
  levelFill: {
    height: "100%",
    borderRadius: 99,
    background: "linear-gradient(90deg, #1a73e8, #60a5fa)",
    transition: "width 0.4s ease",
  },

  // Layout
  twoCol: {
    display: "flex",
    gap: 24,
    maxWidth: 1100,
    margin: "0 auto",
    padding: "28px 28px 48px",
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

  // Page header
  pageHeader: {
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: 800,
    color: "var(--text-primary)",
    margin: "0 0 6px",
  },
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    margin: 0,
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
    alignItems: "center",
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
  } as React.CSSProperties,
  stepTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  },

  // Form controls
  formGroup: {
    marginBottom: 14,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
  },
  optional: {
    fontSize: 12,
    fontWeight: 400,
    color: "var(--text-muted)",
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
  } as React.CSSProperties,
  selectArrow: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    pointerEvents: "none",
    color: "var(--text-muted)",
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
  },

  // Goal cards
  goalGrid: {
    display: "flex",
    gap: 10,
  },
  goalCard: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 5,
    padding: "14px",
    background: "var(--bg-primary)",
    border: "2px solid var(--border-color)",
    borderRadius: 10,
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s, background 0.15s",
  } as React.CSSProperties,
  goalCardSelected: {
    borderColor: "#1a73e8",
    background: "rgba(26,115,232,0.05)",
  },
  goalEmoji: {
    fontSize: 22,
    lineHeight: 1,
  },
  goalLabel: {
    fontSize: 13,
    fontWeight: 700,
  },
  goalDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },

  // Duration
  durationRow: {
    display: "flex",
    gap: 10,
    marginBottom: 16,
  },
  durationPill: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "11px 16px",
    border: "2px solid var(--border-color)",
    borderRadius: 99,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  },
  durationPillActive: {
    borderColor: "#1a73e8",
    background: "rgba(26,115,232,0.05)",
    color: "#1a73e8",
  },
  recommendedBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: "#22c55e",
    color: "#fff",
    borderRadius: 99,
    padding: "2px 7px",
  },

  // Accordion
  accordionBtn: {
    display: "flex",
    alignItems: "center",
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
    width: "100%",
    textAlign: "left",
    fontFamily: "inherit",
  },
  textarea: {
    marginTop: 12,
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
    resize: "vertical",
    boxSizing: "border-box",
    fontFamily: "inherit",
    outline: "none",
  },

  // Error
  errorBox: {
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#ef4444",
    fontWeight: 500,
  },

  // CTA
  startBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "15px 20px",
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    transition: "opacity 0.15s",
    fontFamily: "inherit",
  },
  startBtnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  noteText: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "center",
    margin: "-4px 0 0",
  },

  // Right panel cards
  rightCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "18px 20px",
  },
  rightCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  rightCardIcon: {
    fontSize: 16,
    lineHeight: 1,
  },
  rightCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  },

  // Skeleton loader
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "4px 0",
  },
  skeletonLine: {
    height: 13,
    background: "var(--bg-tertiary, rgba(0,0,0,0.06))",
    borderRadius: 6,
  },

  // Assignment card
  assignmentCard: {
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    padding: "12px 14px",
  },
  assignmentMeta: {
    display: "flex",
    gap: 6,
    marginBottom: 6,
    flexWrap: "wrap",
  },
  assignmentSubjectBadge: {
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(26,115,232,0.1)",
    color: "#1a73e8",
    borderRadius: 99,
    padding: "2px 8px",
  },
  assignmentTypeBadge: {
    fontSize: 11,
    fontWeight: 600,
    background: "var(--bg-tertiary, rgba(0,0,0,0.06))",
    color: "var(--text-muted)",
    borderRadius: 99,
    padding: "2px 8px",
    textTransform: "capitalize",
  },
  assignmentTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 4,
  },
  assignmentTopic: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 10,
  },
  assignmentActions: {
    display: "flex",
    gap: 8,
  },
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
  noAssignment: {
    padding: "12px 0 4px",
    textAlign: "center",
  },
  noAssignmentText: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: 0,
  },

  // Lesson preview steps
  previewSteps: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 14,
  },
  previewStep: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
  },
  previewStepNum: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "#1a73e8",
    color: "#fff",
    fontSize: 11,
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  } as React.CSSProperties,
  previewStepInfo: {
    flex: 1,
    minWidth: 0,
  },
  previewStepTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 2px",
  },
  previewStepDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: 0,
    lineHeight: 1.4,
  },
  previewFooter: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 12px",
    background: "rgba(26,115,232,0.04)",
    border: "1px solid rgba(26,115,232,0.12)",
    borderRadius: 8,
  },
  previewFooterText: {
    fontSize: 12,
    color: "var(--text-secondary)",
    margin: 0,
    lineHeight: 1.5,
  },
};
