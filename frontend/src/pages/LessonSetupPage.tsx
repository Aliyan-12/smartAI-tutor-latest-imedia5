import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, BookOpen, Target, FileText } from "lucide-react";
import { lessonApi, assignmentsApi } from "../services/api";
import type { GeneratedLessonPlan, MyAssignment } from "../types";

const SUBJECTS = [
  "Maths","Science","English","History","Geography",
  "Physics","Chemistry","Biology","Computer Science","French","Spanish",
];

type GoalType = "learn" | "practice" | "test";
type Duration = 30 | 60;

interface LocationState {
  subject?: string;
  topic?: string;
  goal?: string;
}

export default function LessonSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const locationState = (location.state ?? {}) as LocationState;

  const [subject, setSubject] = useState(
    locationState.subject ?? searchParams.get("subject") ?? ""
  );
  const [topic, setTopic] = useState(locationState.topic ?? "");
  const [subtopic, setSubtopic] = useState("");
  const [goal, setGoal] = useState<GoalType>(
    (locationState.goal as GoalType) ?? "learn"
  );
  const [duration, setDuration] = useState<Duration>(30);
  const [extraDetails, setExtraDetails] = useState("");
  const [showExtra, setShowExtra] = useState(false);

  const [assignment, setAssignment] = useState<MyAssignment | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);

  const [plan, setPlan] = useState<GeneratedLessonPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    if (!subject || !topic) {
      setPlan(null);
      return;
    }

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      setPlanLoading(true);
      setPlanError(null);
      lessonApi
        .generatePlan({ subject, topic, subtopic: subtopic || undefined, goal, duration_minutes: duration })
        .then((data) => setPlan(data as GeneratedLessonPlan))
        .catch((e) => setPlanError(e.message))
        .finally(() => setPlanLoading(false));
    }, 700);

    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [subject, topic, subtopic, goal, duration]);

  const handleUseAssignment = () => {
    if (!assignment) return;
    setSubject(assignment.homework.subject);
    setTopic(assignment.homework.topic);
  };

  const handleSubmit = async () => {
    if (!subject || !topic) return;
    setSubmitting(true);

    let lessonPlan = plan;
    if (!lessonPlan) {
      try {
        lessonPlan = (await lessonApi.generatePlan({
          subject, topic,
          subtopic: subtopic || undefined,
          goal,
          duration_minutes: duration,
        })) as GeneratedLessonPlan;
      } catch {
        lessonPlan = null;
      }
    }

    navigate("/chat", {
      state: {
        lessonContext: {
          subject,
          topic,
          subtopic: subtopic || undefined,
          goal,
          duration_minutes: duration,
          lesson_plan: lessonPlan,
          extra_details: extraDetails || undefined,
        },
      },
    });
  };

  const goalOptions: { id: GoalType; icon: React.ReactNode; label: string; desc: string }[] = [
    {
      id: "learn",
      icon: <BookOpen size={22} />,
      label: "Learn from scratch",
      desc: "New to this topic? We'll explain it fully",
    },
    {
      id: "practice",
      icon: <Target size={22} />,
      label: "Practice & Improve",
      desc: "Already know a bit? Let's strengthen your skills",
    },
    {
      id: "test",
      icon: <FileText size={22} />,
      label: "Prepare for test",
      desc: "Got an exam coming? We'll focus on key questions",
    },
  ];

  const blockIcons: Record<string, string> = {
    introduction: "1",
    guided_practice: "2",
    practice: "3",
    review: "4",
  };

  const canSubmit = subject.trim() !== "" && topic.trim() !== "";

  return (
    <div style={styles.page}>
      <div style={styles.twoCol}>
        <div style={styles.leftCol}>
          <div style={styles.pageHeader}>
            <h1 style={styles.pageTitle}>Let's set up your lesson</h1>
            <p style={styles.pageSubtitle}>
              Tell us a few details and your AI Tutor will take it from there.
            </p>
          </div>

          <div style={styles.stepCard}>
            <p style={styles.stepLabel}>Step 1 — What do you want to learn?</p>

            <div style={styles.formGroup}>
              <label style={styles.label}>Subject</label>
              <div style={styles.selectWrap}>
                <select
                  style={styles.select}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  <option value="">Select a subject...</option>
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <ChevronDown size={16} style={styles.selectArrow} />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Topic</label>
              <input
                style={styles.input}
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Fractions, The Water Cycle, World War 2"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                Sub-topic{" "}
                <span style={styles.optional}>(optional)</span>
              </label>
              <input
                style={styles.input}
                type="text"
                value={subtopic}
                onChange={(e) => setSubtopic(e.target.value)}
                placeholder="e.g. Common Denominators"
              />
            </div>
          </div>

          <div style={styles.stepCard}>
            <p style={styles.stepLabel}>Step 2 — What is your goal for this lesson?</p>
            <div style={styles.goalGrid}>
              {goalOptions.map((g) => (
                <button
                  key={g.id}
                  style={{
                    ...styles.goalCard,
                    ...(goal === g.id ? styles.goalCardSelected : {}),
                  }}
                  onClick={() => setGoal(g.id)}
                  type="button"
                >
                  <span style={{
                    ...styles.goalIcon,
                    color: goal === g.id ? "var(--accent-blue, var(--accent))" : "var(--text-muted)",
                  }}>
                    {g.icon}
                  </span>
                  <span style={styles.goalLabel}>{g.label}</span>
                  <span style={styles.goalDesc}>{g.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={styles.stepCard}>
            <p style={styles.stepLabel}>Step 3 — How long would you like your session to be?</p>
            <div style={styles.durationRow}>
              <button
                style={{
                  ...styles.durationPill,
                  ...(duration === 30 ? styles.durationPillActive : {}),
                }}
                onClick={() => setDuration(30)}
                type="button"
              >
                30 Minutes
                {duration === 30 && (
                  <span style={styles.recommendedBadge}>Recommended</span>
                )}
              </button>
              <button
                style={{
                  ...styles.durationPill,
                  ...(duration === 60 ? styles.durationPillActive : {}),
                }}
                onClick={() => setDuration(60)}
                type="button"
              >
                1 Hour
              </button>
            </div>
          </div>

          <div style={styles.stepCard}>
            <button
              style={styles.accordionToggle}
              onClick={() => setShowExtra((v) => !v)}
              type="button"
            >
              <ChevronDown
                size={16}
                style={{
                  transform: showExtra ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                  marginRight: 6,
                }}
              />
              Add more details (optional)
            </button>
            {showExtra && (
              <textarea
                style={styles.textarea}
                value={extraDetails}
                onChange={(e) => setExtraDetails(e.target.value)}
                placeholder="Any extra context, materials, or specific areas to focus on..."
                rows={4}
              />
            )}
          </div>

          <button
            style={{
              ...styles.startBtn,
              ...(canSubmit ? {} : styles.startBtnDisabled),
            }}
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            type="button"
          >
            {submitting ? "Starting..." : "Start Lesson with Tutor"}
            {!submitting && <ChevronRight size={18} style={{ marginLeft: 6 }} />}
          </button>
          <p style={styles.noteText}>
            AI will personalise the lesson based on your choices and progress
          </p>
        </div>

        <div style={styles.rightCol}>
          <div style={styles.rightCard}>
            <p style={styles.rightCardTitle}>Recommended for You</p>
            {assignmentLoading ? (
              <div style={styles.skeletonWrap}>
                {[180, 120, 90].map((w, i) => (
                  <div key={i} style={{ ...styles.skeletonLine, width: w }} />
                ))}
              </div>
            ) : assignment ? (
              <div style={styles.assignmentCard}>
                <div style={styles.assignmentMeta}>
                  <span style={styles.assignmentSubject}>{assignment.homework.subject}</span>
                  <span style={styles.assignmentType}>{assignment.homework.assignment_type}</span>
                </div>
                <p style={styles.assignmentTitle}>{assignment.homework.title}</p>
                {assignment.homework.topic && (
                  <p style={styles.assignmentTopic}>Topic: {assignment.homework.topic}</p>
                )}
                <div style={styles.assignmentActions}>
                  <button
                    style={styles.useBtn}
                    onClick={handleUseAssignment}
                    type="button"
                  >
                    Use This
                  </button>
                  <button
                    style={styles.ignoreBtn}
                    onClick={() => setAssignment(null)}
                    type="button"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ) : (
              <div style={styles.noAssignment}>
                <span style={{ fontSize: 28 }}>📖</span>
                <p style={styles.noAssignmentText}>
                  Start fresh on any topic — just pick a subject and tell us what you want to learn!
                </p>
              </div>
            )}
          </div>

          {(subject && topic) && (
            <div style={styles.rightCard}>
              <p style={styles.rightCardTitle}>Lesson Preview</p>
              {planLoading ? (
                <div style={styles.skeletonWrap}>
                  {[200, 160, 180, 140].map((w, i) => (
                    <div key={i} style={{ ...styles.skeletonLine, width: w }} />
                  ))}
                </div>
              ) : planError ? (
                <p style={styles.planError}>
                  Could not load preview — your lesson will still be personalised.
                </p>
              ) : plan ? (
                <div>
                  <p style={styles.planTitle}>{plan.lesson_title}</p>
                  <p style={styles.planSummary}>{plan.preview_summary}</p>
                  <div style={styles.blockList}>
                    {plan.blocks.map((block, i) => (
                      <div key={i} style={styles.blockItem}>
                        <div style={styles.blockNum}>{i + 1}</div>
                        <div style={styles.blockInfo}>
                          <p style={styles.blockTitle}>{block.title}</p>
                          <p style={styles.blockDesc}>{block.description}</p>
                        </div>
                        <span style={styles.blockDuration}>{block.duration_minutes}m</span>
                      </div>
                    ))}
                  </div>
                  {plan.personalisation_notes && (
                    <p style={styles.personalisationNote}>
                      {plan.personalisation_notes}
                    </p>
                  )}
                  <p style={styles.planFootnote}>
                    AI will personalise based on your progress
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "var(--bg-primary)",
    padding: "32px 24px",
  },
  twoCol: {
    display: "flex",
    gap: 28,
    maxWidth: 1100,
    margin: "0 auto",
    alignItems: "flex-start",
  },
  leftCol: {
    flex: "0 0 58%",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  rightCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    position: "sticky",
    top: 24,
  },
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
  stepCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "20px 22px",
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 16,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
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
  },
  selectArrow: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    pointerEvents: "none",
    color: "var(--text-muted)",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 14,
    boxSizing: "border-box",
  },
  goalGrid: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  goalCard: {
    flex: "1 1 140px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    padding: "14px 14px",
    background: "var(--bg-primary)",
    border: "2px solid var(--border-color)",
    borderRadius: 10,
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
    textAlign: "left",
  },
  goalCardSelected: {
    borderColor: "var(--accent-blue, var(--accent))",
    background: "rgba(99,102,241,0.05)",
  },
  goalIcon: {
    marginBottom: 2,
  },
  goalLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  goalDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },
  durationRow: {
    display: "flex",
    gap: 10,
  },
  durationPill: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "11px 20px",
    border: "2px solid var(--border-color)",
    borderRadius: 99,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "border-color 0.15s",
  },
  durationPillActive: {
    borderColor: "var(--accent-blue, var(--accent))",
    background: "rgba(99,102,241,0.06)",
    color: "var(--accent-blue, var(--accent))",
  },
  recommendedBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: "var(--accent-green, #22c55e)",
    color: "white",
    borderRadius: 99,
    padding: "2px 7px",
    marginLeft: 4,
  },
  accordionToggle: {
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
  },
  startBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "15px 20px",
    background: "var(--accent-blue, var(--accent))",
    color: "white",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    transition: "opacity 0.15s",
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
  rightCard: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    padding: "18px 20px",
  },
  rightCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 14,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  skeletonLine: {
    height: 14,
    background: "var(--bg-tertiary)",
    borderRadius: 6,
  },
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
  assignmentSubject: {
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(99,102,241,0.1)",
    color: "var(--accent-blue, var(--accent))",
    borderRadius: 99,
    padding: "2px 8px",
  },
  assignmentType: {
    fontSize: 11,
    fontWeight: 600,
    background: "var(--bg-tertiary)",
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
    background: "var(--accent-blue, var(--accent))",
    color: "white",
    border: "none",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
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
  },
  noAssignment: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "16px 0",
    textAlign: "center",
  },
  noAssignmentText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    maxWidth: 220,
  },
  planError: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  planTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 6,
  },
  planSummary: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 14,
  },
  blockList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 12,
  },
  blockItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
  },
  blockNum: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "var(--accent-blue, var(--accent))",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  blockInfo: {
    flex: 1,
    minWidth: 0,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 2,
  },
  blockDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },
  blockDuration: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--bg-tertiary)",
    borderRadius: 99,
    padding: "2px 7px",
    flexShrink: 0,
    alignSelf: "center",
  },
  personalisationNote: {
    fontSize: 12,
    color: "var(--accent-blue, var(--accent))",
    fontStyle: "italic",
    marginBottom: 6,
  },
  planFootnote: {
    fontSize: 11,
    color: "var(--text-muted)",
    textAlign: "center",
  },
};
