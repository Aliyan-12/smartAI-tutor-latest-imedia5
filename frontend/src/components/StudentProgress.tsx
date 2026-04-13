import { useState } from "react";
import { Award, ChevronDown, ChevronUp, CheckCircle, XCircle, BookOpen } from "lucide-react";
import type { Assessment, AssessmentQuestion } from "../types";

interface Props {
  studentId: number;
  assessments: Assessment[];
}

function ScoreBadge({ score }: { score: number }) {
  let color = "var(--success)";
  let bg = "var(--success-light)";
  let border = "rgba(24,128,56,0.15)";
  if (score < 40) {
    color = "var(--danger)";
    bg = "var(--danger-light)";
    border = "rgba(217,48,37,0.15)";
  } else if (score < 70) {
    color = "var(--warning)";
    bg = "var(--warning-light)";
    border = "rgba(227,116,0,0.15)";
  }
  return (
    <span
      style={{
        padding: "2px 10px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 700,
        background: bg,
        color,
        border: `1px solid ${border}`,
        whiteSpace: "nowrap",
      }}
    >
      {Math.round(score)}%
    </span>
  );
}

function StatusBadge({ status }: { status: Assessment["status"] }) {
  const styles: Record<Assessment["status"], { bg: string; color: string; border: string }> = {
    completed: {
      bg: "var(--success-light)",
      color: "var(--success)",
      border: "rgba(24,128,56,0.15)",
    },
    in_progress: {
      bg: "var(--warning-light)",
      color: "var(--warning)",
      border: "rgba(227,116,0,0.15)",
    },
  };
  const s = styles[status];
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {status === "in_progress" ? "In Progress" : "Completed"}
    </span>
  );
}

function QuestionBreakdown({ questions }: { questions: AssessmentQuestion[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
      {questions.map((q, idx) => (
        <div
          key={q.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            padding: "9px 12px",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            borderLeft: `3px solid ${q.is_correct ? "var(--success)" : q.is_correct === false ? "var(--danger)" : "var(--border)"}`,
          }}
        >
          {q.is_correct === true ? (
            <CheckCircle size={14} style={{ color: "var(--success)", flexShrink: 0, marginTop: 2 }} />
          ) : q.is_correct === false ? (
            <XCircle size={14} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
          ) : (
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "var(--border)",
                flexShrink: 0,
                marginTop: 2,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-primary)",
                lineHeight: 1.4,
                marginBottom: q.topic_tag ? 3 : 0,
              }}
            >
              <strong style={{ color: "var(--text-muted)", marginRight: 4 }}>Q{idx + 1}.</strong>
              {q.question_text}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {q.topic_tag && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{q.topic_tag}</span>
              )}
              {q.student_answer !== null && q.options[q.student_answer] && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  Your answer:{" "}
                  <em style={{ fontStyle: "normal", fontWeight: 600 }}>
                    {q.options[q.student_answer]}
                  </em>
                </span>
              )}
              {q.is_correct === false && q.correct_answer !== null && q.options[q.correct_answer] && (
                <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 600 }}>
                  Correct: {q.options[q.correct_answer]}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssessmentRow({ assessment }: { assessment: Assessment }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "var(--bg-secondary)",
          cursor: "pointer",
          transition: "background 0.12s",
        }}
        onClick={() => setExpanded((v) => !v)}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
      >
        <BookOpen size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span
          style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}
        >
          {assessment.topic}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 8 }}>
          {new Date(assessment.created_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        {assessment.score_percent !== undefined && assessment.score_percent !== null && (
          <ScoreBadge score={assessment.score_percent} />
        )}
        <StatusBadge status={assessment.status} />
        <div style={{ marginLeft: 6, color: "var(--text-muted)" }}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </div>

      {expanded && assessment.questions && assessment.questions.length > 0 && (
        <div
          style={{
            padding: "14px 16px",
            background: "var(--bg-primary)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <QuestionBreakdown questions={assessment.questions} />
        </div>
      )}

      {expanded && (!assessment.questions || assessment.questions.length === 0) && (
        <div
          style={{
            padding: "14px 16px",
            background: "var(--bg-primary)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No question details available.</p>
        </div>
      )}
    </div>
  );
}

export default function StudentProgress({ studentId: _studentId, assessments }: Props) {
  // Compute summary stats
  const completedAssessments = assessments.filter((a) => a.status === "completed");
  const scores = completedAssessments
    .map((a) => a.score_percent)
    .filter((s): s is number => s !== null && s !== undefined);

  const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const latestScore = completedAssessments.length > 0
    ? completedAssessments[completedAssessments.length - 1].score_percent
    : null;

  // Aggregate weak and strong topics
  const allWeakTopics = new Set<string>();
  const allStrongTopics = new Set<string>();
  for (const a of completedAssessments) {
    (a.weak_topics ?? []).forEach((t) => allWeakTopics.add(t));
    (a.strong_topics ?? []).forEach((t) => allStrongTopics.add(t));
  }
  // Strong topics override weak (if improved)
  const weakTopics = [...allWeakTopics].filter((t) => !allStrongTopics.has(t));
  const strongTopics = [...allStrongTopics];

  const sortedAssessments = [...assessments].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div>
      {/* Summary stats */}
      <div className="stats-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <Award size={18} />
          <div className="stat-value">
            {averageScore !== null ? `${Math.round(averageScore)}%` : "—"}
          </div>
          <div className="stat-label">Average Score</div>
        </div>
        <div className="stat-card">
          <BookOpen size={18} />
          <div className="stat-value">{completedAssessments.length}</div>
          <div className="stat-label">Completed Quizzes</div>
        </div>
        <div className="stat-card">
          <CheckCircle size={18} />
          <div className="stat-value">
            {latestScore !== null ? `${Math.round(latestScore)}%` : "—"}
          </div>
          <div className="stat-label">Latest Score</div>
        </div>
      </div>

      {/* Topics */}
      {(weakTopics.length > 0 || strongTopics.length > 0) && (
        <div className="dashboard-section" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h2>Topics Overview</h2>
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {weakTopics.length > 0 && (
              <div style={{ flex: 1, minWidth: 180 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-muted)",
                    marginBottom: 8,
                  }}
                >
                  Needs improvement
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {weakTopics.map((t) => (
                    <span
                      key={t}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 99,
                        fontSize: 12,
                        fontWeight: 600,
                        background: "var(--danger-light)",
                        color: "var(--danger)",
                        border: "1px solid rgba(217,48,37,0.15)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {strongTopics.length > 0 && (
              <div style={{ flex: 1, minWidth: 180 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-muted)",
                    marginBottom: 8,
                  }}
                >
                  Strong areas
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {strongTopics.map((t) => (
                    <span
                      key={t}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 99,
                        fontSize: 12,
                        fontWeight: 600,
                        background: "var(--success-light)",
                        color: "var(--success)",
                        border: "1px solid rgba(24,128,56,0.15)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assessment history */}
      <div>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--text-muted)",
            marginBottom: 10,
          }}
        >
          Assessment history ({assessments.length})
        </p>
        {sortedAssessments.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
            No assessments yet.
          </p>
        )}
        {sortedAssessments.map((a) => (
          <AssessmentRow key={a.id} assessment={a} />
        ))}
      </div>
    </div>
  );
}
