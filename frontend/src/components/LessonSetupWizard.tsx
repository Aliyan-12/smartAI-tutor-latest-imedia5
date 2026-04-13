import { useEffect, useState, useCallback } from "react";
import { lessonsApi, gamificationApi } from "../services/api";
import type { LessonPlan, TopicMastery } from "../types";

interface Props {
  studentId: number;
  onStart: (lessonPlanId: number) => void;
  onCancel: () => void;
  defaultSubject?: string;
  defaultKeyStage?: string;
}

const SUBJECTS = [
  "Mathematics",
  "English",
  "Science",
  "Biology",
  "Chemistry",
  "Physics",
  "History",
  "Geography",
  "Computer Science",
  "Religious Studies",
  "French",
  "Spanish",
  "German",
  "Art & Design",
  "Music",
  "Drama",
  "Physical Education",
  "Business Studies",
  "Economics",
  "Psychology",
  "Sociology",
];

const KEY_STAGES = ["KS1", "KS2", "KS3", "KS4", "KS5"];

const ABILITY_OPTIONS = [
  { value: "beginner", label: "I'm new to this", icon: "🌱" },
  { value: "developing", label: "I've started learning it", icon: "📖" },
  { value: "practicing", label: "I need practice", icon: "✏️" },
  { value: "advanced", label: "I want a challenge", icon: "🚀" },
];

const GOAL_OPTIONS = [
  { value: "teach", label: "Teach me from scratch", icon: "🎓" },
  { value: "homework", label: "Help me with homework", icon: "📝" },
  { value: "test", label: "Test me with questions", icon: "🎯" },
  { value: "revise", label: "Revise quickly", icon: "⚡" },
];

export default function LessonSetupWizard({
  studentId,
  onStart,
  onCancel,
  defaultSubject = "",
  defaultKeyStage = "",
}: Props) {
  const [subject, setSubject] = useState(defaultSubject || SUBJECTS[0]);
  const [keyStage, setKeyStage] = useState(defaultKeyStage || "KS3");
  const [topics, setTopics] = useState<Array<{ unit_name: string; document_count: number }>>([]);
  const [unitName, setUnitName] = useState("");
  const [subtopics, setSubtopics] = useState<string[]>([]);
  const [subtopic, setSubtopic] = useState("");
  const [abilityLevel, setAbilityLevel] = useState("developing");
  const [goal, setGoal] = useState("teach");
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingSubtopics, setLoadingSubtopics] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mastery, setMastery] = useState<TopicMastery[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  /* Load topics when subject or key stage changes */
  const loadTopics = useCallback(async () => {
    if (!subject || !keyStage) return;
    setLoadingTopics(true);
    setTopics([]);
    setUnitName("");
    setSubtopics([]);
    setSubtopic("");
    try {
      const res = await lessonsApi.getTopics(subject, keyStage);
      setTopics(res.topics);
      if (res.topics.length > 0) setUnitName(res.topics[0].unit_name);
    } catch {
      setTopics([]);
    } finally {
      setLoadingTopics(false);
    }
  }, [subject, keyStage]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  /* Load subtopics when unit changes */
  useEffect(() => {
    if (!unitName || !subject) {
      setSubtopics([]);
      setSubtopic("");
      return;
    }
    setLoadingSubtopics(true);
    lessonsApi
      .getSubtopics(subject, unitName)
      .then((res) => {
        setSubtopics(res.subtopics);
        setSubtopic(res.subtopics[0] ?? "");
      })
      .catch(() => {
        setSubtopics([]);
        setSubtopic("");
      })
      .finally(() => setLoadingSubtopics(false));
  }, [subject, unitName]);

  /* Load mastery data for context panel */
  useEffect(() => {
    gamificationApi
      .getMastery()
      .then((d) => setMastery(d as TopicMastery[]))
      .catch(() => {});
  }, []);

  const weakAreas = mastery
    .filter((m) => m.mastery_level === "learning" || m.mastery_level === "not_started")
    .slice(0, 4);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const plan = (await lessonsApi.create({
        student_id: studentId,
        subject,
        key_stage: keyStage,
        unit_name: unitName || undefined,
        subtopic: subtopic || undefined,
        ability_level: abilityLevel,
        goal,
      })) as LessonPlan;
      const started = (await lessonsApi.start(plan.id)) as LessonPlan;
      onStart(started.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create lesson plan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lesson-wizard-overlay">
      <div className="lesson-wizard">
        {/* Header */}
        <div className="lw-header">
          <div className="lw-header-left">
            <h2 className="lw-title">Set Up Your Lesson</h2>
            <p className="lw-subtitle">
              Help your AI tutor personalise this session for you.
            </p>
          </div>
          <button className="lw-close-btn" onClick={onCancel} aria-label="Cancel">
            ✕
          </button>
        </div>

        <div className="lw-body">
          {/* LEFT — form */}
          <div className="lw-form-panel">
            {/* Subject + Key Stage */}
            <div className="lw-row">
              <div className="lw-field">
                <label className="lw-label">Subject</label>
                <select
                  className="lw-select"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lw-field lw-field--sm">
                <label className="lw-label">Key Stage</label>
                <select
                  className="lw-select"
                  value={keyStage}
                  onChange={(e) => setKeyStage(e.target.value)}
                >
                  {KEY_STAGES.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Topic / Unit */}
            <div className="lw-field">
              <label className="lw-label">
                Topic / Unit
                {loadingTopics && <span className="lw-loading-dot"> Loading…</span>}
              </label>
              {topics.length > 0 ? (
                <select
                  className="lw-select"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                >
                  {topics.map((t) => (
                    <option key={t.unit_name} value={t.unit_name}>
                      {t.unit_name} ({t.document_count} docs)
                    </option>
                  ))}
                </select>
              ) : (
                !loadingTopics && (
                  <input
                    className="lw-input"
                    placeholder="e.g. Algebra, Forces, World War II"
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                  />
                )
              )}
            </div>

            {/* Subtopic */}
            {(subtopics.length > 0 || unitName) && (
              <div className="lw-field">
                <label className="lw-label">
                  Subtopic
                  {loadingSubtopics && <span className="lw-loading-dot"> Loading…</span>}
                </label>
                {subtopics.length > 0 ? (
                  <select
                    className="lw-select"
                    value={subtopic}
                    onChange={(e) => setSubtopic(e.target.value)}
                  >
                    <option value="">— Any subtopic —</option>
                    {subtopics.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                ) : (
                  !loadingSubtopics && (
                    <input
                      className="lw-input"
                      placeholder="Optional — leave blank for general topic"
                      value={subtopic}
                      onChange={(e) => setSubtopic(e.target.value)}
                    />
                  )
                )}
              </div>
            )}

            {/* Ability level */}
            <div className="lw-field">
              <label className="lw-label">Your current ability</label>
              <div className="lw-pill-grid">
                {ABILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`ability-pill ${abilityLevel === opt.value ? "ability-pill--active" : ""}`}
                    onClick={() => setAbilityLevel(opt.value)}
                    type="button"
                  >
                    <span className="pill-icon">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Goal */}
            <div className="lw-field">
              <label className="lw-label">What do you want to do?</label>
              <div className="lw-pill-grid">
                {GOAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`goal-pill ${goal === opt.value ? "goal-pill--active" : ""}`}
                    onClick={() => setGoal(opt.value)}
                    type="button"
                  >
                    <span className="pill-icon">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* File upload */}
            <div className="lw-field">
              <label className="lw-label">Upload materials (optional)</label>
              <div
                className={`lw-upload-area ${uploadedFile ? "lw-upload-area--filled" : ""}`}
                onClick={() => document.getElementById("lw-file-input")?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) setUploadedFile(f);
                }}
              >
                {uploadedFile ? (
                  <>
                    <span className="lw-upload-icon">📄</span>
                    <span className="lw-upload-name">{uploadedFile.name}</span>
                    <button
                      className="lw-upload-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFile(null);
                      }}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="lw-upload-icon">📎</span>
                    <span className="lw-upload-hint">
                      Drag &amp; drop or click to add a worksheet, notes, or past paper
                    </span>
                  </>
                )}
                <input
                  id="lw-file-input"
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setUploadedFile(f);
                  }}
                />
              </div>
            </div>

            {error && <p className="lw-error">{error}</p>}
          </div>

          {/* RIGHT — context panel */}
          <div className="lw-context-panel">
            <div className="lw-context-inner">
              <h4 className="lw-context-title">🧠 Learning Context</h4>

              {weakAreas.length > 0 ? (
                <>
                  <p className="lw-context-desc">
                    Based on your progress, these areas need attention:
                  </p>
                  <ul className="lw-weak-list">
                    {weakAreas.map((w) => (
                      <li
                        key={w.id}
                        className="lw-weak-item"
                        onClick={() => {
                          setSubject(w.subject);
                          setUnitName(w.topic);
                        }}
                      >
                        <span className="lw-weak-dot" />
                        <div className="lw-weak-info">
                          <span className="lw-weak-topic">{w.topic}</span>
                          <span className="lw-weak-sub">{w.subject} · {w.key_stage}</span>
                        </div>
                        <span className="lw-weak-tag">
                          {w.mastery_level === "not_started" ? "Not started" : "Learning"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="lw-context-empty">
                  <span>📊</span>
                  <p>Complete a lesson to unlock personalised recommendations.</p>
                </div>
              )}

              <hr className="lw-context-divider" />

              <div className="lw-session-summary">
                <h4 className="lw-context-title">Session Preview</h4>
                <div className="lw-preview-row">
                  <span>Subject</span>
                  <strong>{subject}</strong>
                </div>
                <div className="lw-preview-row">
                  <span>Key Stage</span>
                  <strong>{keyStage}</strong>
                </div>
                {unitName && (
                  <div className="lw-preview-row">
                    <span>Topic</span>
                    <strong>{unitName}</strong>
                  </div>
                )}
                {subtopic && (
                  <div className="lw-preview-row">
                    <span>Subtopic</span>
                    <strong>{subtopic}</strong>
                  </div>
                )}
                <div className="lw-preview-row">
                  <span>Goal</span>
                  <strong>
                    {GOAL_OPTIONS.find((g) => g.value === goal)?.label}
                  </strong>
                </div>
                <div className="lw-preview-row">
                  <span>Ability</span>
                  <strong>
                    {ABILITY_OPTIONS.find((a) => a.value === abilityLevel)?.label}
                  </strong>
                </div>
              </div>
            </div>

            <button
              className="lw-start-btn"
              onClick={handleSubmit}
              disabled={submitting || !subject}
            >
              {submitting ? (
                <>
                  <span className="lw-spin" /> Setting up…
                </>
              ) : (
                "🎓 Start Lesson with Tutor"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
