import { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, Award, ChevronRight, RotateCcw } from "lucide-react";
import { assessmentsApi } from "../services/api";
import type { Assessment, AssessmentQuestion } from "../types";

function playCorrectSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      osc.start(t); osc.stop(t + 0.42);
    });
  } catch {}
}

function playWrongSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.32);
  } catch {}
}

if (typeof document !== "undefined" && !document.getElementById("quiz-anim-styles")) {
  const s = document.createElement("style");
  s.id = "quiz-anim-styles";
  s.textContent = `
    @keyframes quizCorrectFlash {
      0%   { background: rgba(16,185,129,0.08); }
      25%  { background: rgba(16,185,129,0.28); box-shadow: 0 0 0 3px rgba(16,185,129,0.25); }
      100% { background: rgba(16,185,129,0.08); }
    }
    @keyframes quizWrongShake {
      0%,100% { transform: translateX(0); }
      18%     { transform: translateX(-7px); }
      36%     { transform: translateX(7px); }
      54%     { transform: translateX(-4px); }
      72%     { transform: translateX(4px); }
    }
  `;
  document.head.appendChild(s);
}

type Phase = "confirming" | "loading" | "questioning" | "feedback" | "completed";

interface Props {
  quizOffer: { topic: string; chat_session_id: string };
  onComplete: (assessment: Assessment) => void;
  onDecline: () => void;
}

interface FeedbackState {
  selectedAnswer: number;
  isCorrect: boolean;
  explanation: string | null;
  correctAnswer: number | null;
}

export default function AssessmentMode({ quizOffer, onComplete, onDecline }: Props) {
  const [phase, setPhase] = useState<Phase>("confirming");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [error, setError] = useState("");
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const startAssessment = async () => {
    setPhase("loading");
    setError("");
    try {
      const result = (await assessmentsApi.start({
        chat_session_id: quizOffer.chat_session_id,
        subject: "General",
        key_stage: "KS3",
        topic: quizOffer.topic,
      })) as Assessment;
      setAssessment(result);
      setCurrentQuestionIndex(0);
      setPhase("questioning");
    } catch (err: any) {
      setError(err.message || "Failed to start assessment");
      setPhase("confirming");
    }
  };

  const handleAnswerSelect = async (answerIndex: number) => {
    if (!assessment || phase !== "questioning") return;

    const currentQuestion = assessment.questions[currentQuestionIndex];
    setPhase("feedback");

    try {
      const updatedQuestion = (await assessmentsApi.submitAnswer(assessment.id, {
        question_index: currentQuestion.question_index,
        student_answer: answerIndex,
      })) as AssessmentQuestion;

      setFeedback({
        selectedAnswer: answerIndex,
        isCorrect: updatedQuestion.is_correct ?? false,
        explanation: updatedQuestion.explanation,
        correctAnswer: updatedQuestion.correct_answer,
      });

      if (updatedQuestion.is_correct) playCorrectSound(); else playWrongSound();

      // Update local assessment questions list
      setAssessment((prev) => {
        if (!prev) return prev;
        const updatedQuestions = prev.questions.map((q, idx) =>
          idx === currentQuestionIndex ? { ...q, ...updatedQuestion } : q
        );
        return { ...prev, questions: updatedQuestions };
      });

      feedbackTimerRef.current = setTimeout(() => {
        const nextIndex = currentQuestionIndex + 1;
        if (nextIndex < assessment.questions.length) {
          setCurrentQuestionIndex(nextIndex);
          setFeedback(null);
          setPhase("questioning");
        } else {
          completeAssessment();
        }
      }, 2200);
    } catch (err: any) {
      setError(err.message || "Failed to submit answer");
      setFeedback(null);
      setPhase("questioning");
    }
  };

  const completeAssessment = async () => {
    if (!assessment) return;
    try {
      const completed = (await assessmentsApi.complete(assessment.id)) as Assessment;
      setAssessment(completed);
      setFeedback(null);
      setPhase("completed");
    } catch (err: any) {
      setError(err.message || "Failed to complete assessment");
      setPhase("questioning");
    }
  };

  const getOptionLabel = (index: number) => ["A", "B", "C", "D"][index] ?? String(index + 1);

  const getOptionStyle = (optionIndex: number): React.CSSProperties => {
    if (phase !== "feedback" || !feedback) {
      return {};
    }
    if (feedback.correctAnswer !== null && optionIndex === feedback.correctAnswer) {
      return {
        background: "var(--success-light)",
        borderColor: "var(--success)",
        color: "var(--success)",
        animation: "quizCorrectFlash 0.5s ease forwards",
      };
    }
    if (optionIndex === feedback.selectedAnswer && !feedback.isCorrect) {
      return {
        background: "var(--danger-light)",
        borderColor: "var(--danger)",
        color: "var(--danger)",
        animation: "quizWrongShake 0.45s ease forwards",
      };
    }
    return { opacity: 0.45 };
  };

  // ── Confirming ──────────────────────────────────────────────────────────────
  if (phase === "confirming") {
    return (
      <div
        style={{
          padding: "20px 24px",
          background: "var(--bg-secondary)",
          borderTop: "1px solid var(--border)",
        }}
      >
        {error && (
          <div className="dashboard-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <Award size={28} style={{ color: "var(--accent)", marginBottom: 10 }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            Ready for a quiz on <em style={{ fontStyle: "normal", color: "var(--accent)" }}>{quizOffer.topic}</em>?
          </h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18 }}>
            Test your understanding with a short multiple-choice quiz. It only takes a few minutes!
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn-primary" onClick={startAssessment}>
              <CheckCircle size={15} />
              Yes, let's go!
            </button>
            <button className="btn-secondary" onClick={onDecline}>
              <XCircle size={15} />
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div
        style={{
          padding: "28px 24px",
          background: "var(--bg-secondary)",
          borderTop: "1px solid var(--border)",
          textAlign: "center",
        }}
      >
        <div className="typing-indicator" style={{ justifyContent: "center", marginBottom: 10 }}>
          <span /><span /><span />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Preparing your quiz…</p>
      </div>
    );
  }

  // ── Questioning / Feedback ───────────────────────────────────────────────────
  if ((phase === "questioning" || phase === "feedback") && assessment) {
    const currentQuestion = assessment.questions[currentQuestionIndex];
    const totalQuestions = assessment.questions.length;
    const progressPercent = ((currentQuestionIndex) / totalQuestions) * 100;

    return (
      <div
        style={{
          padding: "20px 24px",
          background: "var(--bg-secondary)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          {/* Progress bar */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                Question {currentQuestionIndex + 1} of {totalQuestions}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {quizOffer.topic}
              </span>
            </div>
            <div
              style={{
                height: 4,
                background: "var(--bg-tertiary)",
                borderRadius: 99,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progressPercent}%`,
                  background: "var(--accent)",
                  borderRadius: 99,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>

          {/* Question text */}
          <p
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.55,
              marginBottom: 16,
            }}
          >
            {currentQuestion.question_text}
          </p>

          {/* Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {currentQuestion.options.map((option, idx) => (
              <button
                key={idx}
                disabled={phase === "feedback"}
                onClick={() => handleAnswerSelect(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "11px 16px",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  fontSize: 14,
                  color: "var(--text-primary)",
                  textAlign: "left",
                  cursor: phase === "feedback" ? "default" : "pointer",
                  transition: "all 0.15s",
                  ...getOptionStyle(idx),
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                    color: "inherit",
                  }}
                >
                  {getOptionLabel(idx)}
                </span>
                {option}
              </button>
            ))}
          </div>

          {/* Feedback explanation */}
          {phase === "feedback" && feedback && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "var(--radius)",
                background: feedback.isCorrect ? "var(--success-light)" : "var(--danger-light)",
                border: `1px solid ${feedback.isCorrect ? "rgba(24,128,56,0.2)" : "rgba(217,48,37,0.2)"}`,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              {feedback.isCorrect ? (
                <CheckCircle size={16} style={{ color: "var(--success)", flexShrink: 0, marginTop: 1 }} />
              ) : (
                <XCircle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
              )}
              <div>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: feedback.isCorrect ? "var(--success)" : "var(--danger)",
                    marginBottom: feedback.explanation ? 4 : 0,
                  }}
                >
                  {feedback.isCorrect ? "Correct!" : "Not quite."}
                </p>
                {feedback.explanation && (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {feedback.explanation}
                  </p>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="dashboard-error" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Completed ───────────────────────────────────────────────────────────────
  if (phase === "completed" && assessment) {
    const scorePercent = assessment.score_percent ?? 0;
    const passed = scorePercent >= 60;

    return (
      <div
        style={{
          padding: "24px",
          background: "var(--bg-secondary)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {/* Score header */}
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <Award
              size={36}
              style={{
                color: passed ? "var(--success)" : "var(--warning)",
                marginBottom: 10,
              }}
            />
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              Quiz Complete!
            </h3>
            <div
              style={{
                fontSize: 42,
                fontWeight: 800,
                color: passed ? "var(--success)" : "var(--warning)",
                lineHeight: 1,
                marginBottom: 4,
              }}
            >
              {Math.round(scorePercent)}%
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {assessment.correct_answers} of {assessment.total_questions} correct on{" "}
              <strong>{assessment.topic}</strong>
            </p>
          </div>

          {/* Score bar */}
          <div
            style={{
              height: 8,
              background: "var(--bg-tertiary)",
              borderRadius: 99,
              overflow: "hidden",
              marginBottom: 22,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${scorePercent}%`,
                background: passed ? "var(--success)" : "var(--warning)",
                borderRadius: 99,
                transition: "width 0.6s ease",
              }}
            />
          </div>

          {/* Topics */}
          <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            {assessment.weak_topics && assessment.weak_topics.length > 0 && (
              <div style={{ flex: 1, minWidth: 200 }}>
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
                  Areas to improve
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {assessment.weak_topics.map((t) => (
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

            {assessment.strong_topics && assessment.strong_topics.length > 0 && (
              <div style={{ flex: 1, minWidth: 200 }}>
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
                  {assessment.strong_topics.map((t) => (
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

          {/* Report text */}
          {assessment.report_text && (
            <div
              style={{
                padding: "14px 16px",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                marginBottom: 18,
              }}
            >
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {assessment.report_text}
              </p>
            </div>
          )}

          {/* Per-question breakdown */}
          <div style={{ marginBottom: 20 }}>
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
              Question breakdown
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {assessment.questions.map((q, idx) => (
                <div
                  key={q.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    borderLeft: `3px solid ${q.is_correct ? "var(--success)" : "var(--danger)"}`,
                  }}
                >
                  {q.is_correct ? (
                    <CheckCircle size={14} style={{ color: "var(--success)", flexShrink: 0, marginTop: 2 }} />
                  ) : (
                    <XCircle size={14} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.4, marginBottom: 2 }}>
                      <strong style={{ color: "var(--text-muted)", marginRight: 4 }}>Q{idx + 1}.</strong>
                      {q.question_text}
                    </p>
                    {q.topic_tag && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{q.topic_tag}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Back to chat */}
          <button
            className="btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => onComplete(assessment)}
          >
            <ChevronRight size={15} />
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  return null;
}
