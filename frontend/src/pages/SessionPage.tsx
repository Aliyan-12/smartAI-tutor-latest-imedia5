import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Lock, X, Pause, Play } from "lucide-react";
import { appointmentsApi, assessmentsApi, sessionsApi, gamificationApi } from "../services/api";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import AssessmentMode from "../components/AssessmentMode";
import PostSessionScreen from "../components/PostSessionScreen";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { useAuth } from "../context/AuthContext";
import type { Assessment, ChatMessage } from "../types";

type SessionState = "passcode" | "active" | "ended";
type LearnTab = "learn" | "test";

const SUBJECTS = [
  "Maths","Science","English","History","Geography",
  "Physics","Chemistry","Biology","Computer Science","French","Spanish",
];

export default function SessionPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sessionState, setSessionState] = useState<SessionState>("passcode");
  const [passcode, setPasscode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [totalPausedMs, setTotalPausedMs] = useState(0);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionSubject, setSessionSubject] = useState("");
  const [learnTab, setLearnTab] = useState<LearnTab>("learn");
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanelView, setMobilePanelView] = useState<"chat" | "learn">("chat");
  const [xp, setXp] = useState(0);
  const timerRef = useRef<number | null>(null);

  const [practiceAssessment, setPracticeAssessment] = useState<Assessment | null>(null);
  const [testAssessment, setTestAssessment] = useState<Assessment | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [practiceResult, setPracticeResult] = useState<{ score: number; weak: string[]; strong: string[]; report: string } | null>(null);
  const [testResult, setTestResult] = useState<{
    score: number;
    weak: string[];
    strong: string[];
    report: string;
    questions: Array<{ question_text: string; is_correct: boolean | null }>;
    totalCorrect: number;
    topic: string;
  } | null>(null);
  const [practiceCurrentQ, setPracticeCurrentQ] = useState(0);
  const [testCurrentQ, setTestCurrentQ] = useState(0);
  const [practiceFeedback, setPracticeFeedback] = useState<{ selectedAnswer: number; isCorrect: boolean; explanation: string | null; correctAnswer: number | null } | null>(null);
  const [testFeedback, setTestFeedback] = useState<{ selectedAnswer: number; isCorrect: boolean; explanation: string | null; correctAnswer: number | null } | null>(null);
  const [practiceAnswering, setPracticeAnswering] = useState(false);
  const [testAnswering, setTestAnswering] = useState(false);

  const {
    messages, streaming, streamContent, sendMessage, stopStreaming,
    initSessionChat, activeSessionId, quizOffer, clearQuizOffer,
  } = useChat();

  const { voiceStatus, playing, speakText, connectVoice, disconnectVoice, isVoiceActive, startStreamTTS, feedStreamTTS, endStreamTTS, sendQuizResult } = useVoice();
  const [voiceMessages, setVoiceMessages] = useState<{ role: string; content: string }[]>([]);
  const voiceAiTurnRef = useRef("");
  const [voiceQuizTopic, setVoiceQuizTopic] = useState<string | null>(null);

  const apptId = appointmentId ? parseInt(appointmentId) : 0;

  const handleJoin = async () => {
    if (!appointmentId) return;
    setJoinError("");
    try {
      const result = await appointmentsApi.joinSession(parseInt(appointmentId), passcode) as any;
      setSessionStartedAt(result.session_started_at);
      setDurationMinutes(result.duration_minutes);
      setSessionTitle(result.title);
      setSessionSubject(result.subject);

      // Restore persisted pause state
      const savedPausedSeconds: number = result.total_paused_seconds || 0;
      setTotalPausedMs(savedPausedSeconds * 1000);

      if (result.status === "paused" && result.paused_at) {
        // Session was paused — restore frozen timer position
        const pausedAtMs = new Date(result.paused_at).getTime();
        // Add time elapsed since last pause to total, so timer stays frozen at paused position
        const extraSinceLastPause = Date.now() - pausedAtMs;
        setTotalPausedMs((savedPausedSeconds * 1000) + extraSinceLastPause);
        setIsPaused(true);
        setPausedAt(Date.now()); // mark as currently paused from now
      } else {
        setIsPaused(false);
        setPausedAt(null);
      }

      setSessionState("active");
      initSessionChat(parseInt(appointmentId));

      // Restore any in-progress test so a page refresh doesn't lose quiz state
      try {
        const latestTest = await sessionsApi.getLatestTest(parseInt(appointmentId));
        if (latestTest && latestTest.status === "in_progress" && latestTest.questions?.length > 0) {
          setTestAssessment(latestTest);
          const firstUnanswered = latestTest.questions.findIndex(
            (q) => q.student_answer == null
          );
          setTestCurrentQ(firstUnanswered >= 0 ? firstUnanswered : latestTest.questions.length - 1);
          setLearnTab("test");
        }
      } catch {}
    } catch (err: any) {
      setJoinError(err.message || "Invalid passcode or session unavailable");
    }
  };

  useEffect(() => {
    gamificationApi.getProfile().then((p: any) => setXp(p?.xp_total ?? 0)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!quizOffer) return;
    if (testAssessment || testLoading || testResult) return;
    if (sessionState !== "active" || isPaused) return;
    setLearnTab("test");
    handleStartTest();
  }, [quizOffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voice quiz trigger: when AI voice response contains a quiz offer
  useEffect(() => {
    if (!voiceQuizTopic) return;
    if (testAssessment || testLoading || testResult) { setVoiceQuizTopic(null); return; }
    setLearnTab("test");
    handleStartTest(voiceQuizTopic);
    setVoiceQuizTopic(null);
  }, [voiceQuizTopic]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sessionState !== "active" || !sessionStartedAt || isPaused) return;

    const updateTimer = () => {
      const start = new Date(sessionStartedAt).getTime();
      const end = start + durationMinutes * 60 * 1000 + totalPausedMs;
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        appointmentsApi.updateStatus(apptId, "terminated").catch(() => {});
        setSessionState("ended");
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };

    updateTimer();
    timerRef.current = window.setInterval(updateTimer, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionState, sessionStartedAt, durationMinutes, isPaused, totalPausedMs, apptId]);

  // Auto-read test question via TTS when voice is active
  useEffect(() => {
    if (!isVoiceActive || !testAssessment) return;
    const q = testAssessment.questions[testCurrentQ];
    if (!q) return;
    const opts = q.options.map((o, i) => `${["A", "B", "C", "D"][i]}: ${o}`).join(". ");
    speakText(`Question ${testCurrentQ + 1}: ${q.question_text}. Options: ${opts}`);
  }, [testCurrentQ, testAssessment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-read feedback via TTS when voice is active
  useEffect(() => {
    if (!isVoiceActive || !testFeedback) return;
    const result = testFeedback.isCorrect ? "Correct!" : "Not quite.";
    const explanation = testFeedback.explanation ? ` ${testFeedback.explanation}` : "";
    speakText(`${result}${explanation}`);
  }, [testFeedback]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-read final test score via TTS when voice is active
  useEffect(() => {
    if (!isVoiceActive || !testResult) return;
    speakText(`Quiz complete! You scored ${Math.round(testResult.score)} percent. ${testResult.weak.length > 0 ? `Areas to review: ${testResult.weak.join(", ")}.` : "Great job on all topics!"}`);
  }, [testResult]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handlePause = async () => {
    if (isPaused) {
      // Resume — credit all time since local pausedAt into totalPausedMs
      const now = Date.now();
      const localPauseDuration = pausedAt ? now - pausedAt : 0;
      setTotalPausedMs((p) => p + localPauseDuration);
      setPausedAt(null);
      setIsPaused(false);
      await appointmentsApi.updateStatus(apptId, "started").catch(() => {});
    } else {
      // Pause — disconnect voice if active
      if (isVoiceActive) disconnectVoice();
      if (timerRef.current) clearInterval(timerRef.current);
      setPausedAt(Date.now());
      setIsPaused(true);
      await appointmentsApi.updateStatus(apptId, "paused").catch(() => {});
    }
  };

  const handleEndSession = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    await appointmentsApi.updateStatus(apptId, "terminated").catch(() => {});
    setSessionState("ended");
  };

  const handleStartPractice = async () => {
    if (!apptId) return;
    setPracticeLoading(true);
    setPracticeError(null);
    try {
      const a = await sessionsApi.startPractice(apptId);
      setPracticeAssessment(a);
      setPracticeCurrentQ(0);
      setPracticeFeedback(null);
    } catch (err: any) {
      setPracticeError(err.message || "Failed to generate practice questions");
    } finally {
      setPracticeLoading(false);
    }
  };

  const handleStartTest = async (topicOverride?: string) => {
    if (!apptId) return;
    setTestLoading(true);
    setTestError(null);
    try {
      const a = await sessionsApi.startTest(apptId, topicOverride ? { topic: topicOverride } : undefined);
      setTestAssessment(a);
      setTestCurrentQ(0);
      setTestFeedback(null);
    } catch (err: any) {
      setTestError(err.message || "Failed to generate test");
    } finally {
      setTestLoading(false);
    }
  };

  const handlePracticeAnswer = async (answerIndex: number) => {
    if (!practiceAssessment || practiceAnswering) return;
    setPracticeAnswering(true);
    try {
      const q = practiceAssessment.questions[practiceCurrentQ];
      const updated = await assessmentsApi.submitAnswer(practiceAssessment.id, {
        question_index: q.question_index,
        student_answer: answerIndex,
      }) as import("../types").AssessmentQuestion;
      setPracticeFeedback({
        selectedAnswer: answerIndex,
        isCorrect: updated.is_correct ?? false,
        explanation: updated.explanation,
        correctAnswer: updated.correct_answer,
      });
      setPracticeAssessment((prev) => {
        if (!prev) return prev;
        return { ...prev, questions: prev.questions.map((q2, i) => i === practiceCurrentQ ? { ...q2, ...updated } : q2) };
      });
    } catch (err: any) {
      setPracticeError(err.message || "Failed to submit answer");
    } finally {
      setPracticeAnswering(false);
    }
  };

  const handlePracticeNext = async () => {
    if (!practiceAssessment) return;
    const next = practiceCurrentQ + 1;
    if (next < practiceAssessment.questions.length) {
      setPracticeCurrentQ(next);
      setPracticeFeedback(null);
    } else {
      try {
        const completed = await assessmentsApi.complete(practiceAssessment.id) as Assessment;
        setPracticeResult({
          score: completed.score_percent ?? 0,
          weak: completed.weak_topics ?? [],
          strong: completed.strong_topics ?? [],
          report: completed.report_text ?? "",
        });
        setPracticeAssessment(null);
        setPracticeFeedback(null);
      } catch (err: any) {
        setPracticeError(err.message || "Failed to complete practice");
      }
    }
  };

  const handleTestAnswer = async (answerIndex: number) => {
    if (!testAssessment || testAnswering) return;
    setTestAnswering(true);
    try {
      const q = testAssessment.questions[testCurrentQ];
      const updated = await assessmentsApi.submitAnswer(testAssessment.id, {
        question_index: q.question_index,
        student_answer: answerIndex,
      }) as import("../types").AssessmentQuestion;
      setTestFeedback({
        selectedAnswer: answerIndex,
        isCorrect: updated.is_correct ?? false,
        explanation: updated.explanation,
        correctAnswer: updated.correct_answer,
      });
      setTestAssessment((prev) => {
        if (!prev) return prev;
        return { ...prev, questions: prev.questions.map((q2, i) => i === testCurrentQ ? { ...q2, ...updated } : q2) };
      });
    } catch (err: any) {
      setTestError(err.message || "Failed to submit answer");
    } finally {
      setTestAnswering(false);
    }
  };

  const handleTestNext = async () => {
    if (!testAssessment) return;
    const next = testCurrentQ + 1;
    if (next < testAssessment.questions.length) {
      setTestCurrentQ(next);
      setTestFeedback(null);
    } else {
      try {
        const capturedQuestions = testAssessment.questions;
        const completed = await assessmentsApi.complete(testAssessment.id) as Assessment;
        const quizScore = completed.score_percent ?? 0;
        const quizWeak: string[] = Array.isArray(completed.weak_topics) ? completed.weak_topics : [];
        const quizStrong: string[] = Array.isArray(completed.strong_topics) ? completed.strong_topics : [];
        const quizTopic = completed.topic || quizOffer?.topic || sessionSubject || "the quiz";
        setTestResult({
          score: quizScore,
          weak: quizWeak,
          strong: quizStrong,
          report: completed.report_text ?? "",
          questions: capturedQuestions.map((q) => ({
            question_text: q.question_text,
            is_correct: q.is_correct ?? null,
          })),
          totalCorrect: capturedQuestions.filter((q) => q.is_correct === true).length,
          topic: quizTopic,
        });
        setTestAssessment(null);
        setTestFeedback(null);
        clearQuizOffer();

        // Notify AI of quiz result in real-time
        if (isVoiceActive) {
          sendQuizResult(quizTopic, quizScore, quizStrong, quizWeak);
        } else {
          const weakNote = quizWeak.length > 0 ? ` I struggled with: ${quizWeak.join(", ")}.` : "";
          const strongNote = quizStrong.length > 0 ? ` I did well on: ${quizStrong.join(", ")}.` : "";
          sessionSend(
            `I just finished the quiz on "${quizTopic}". My score was ${Math.round(quizScore)}%.${strongNote}${weakNote} Please give me feedback and tell me what to focus on next.`
          );
        }
      } catch (err: any) {
        setTestError(err.message || "Failed to complete test");
      }
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Merge DB messages with live voice transcripts so they stream in real-time
  const voiceChatMessages: ChatMessage[] = voiceMessages.map((m, i) => ({
    id: -(i + 1),
    chat_id: 0,
    role: m.role as "user" | "assistant",
    content: m.content,
    timestamp: new Date().toISOString(),
  }));
  const displayMessages = voiceChatMessages.length > 0
    ? [...messages, ...voiceChatMessages]
    : messages;

  const totalSeconds = durationMinutes * 60;
  const elapsedSeconds = totalSeconds - timeRemaining;
  const progressFraction = totalSeconds > 0 ? elapsedSeconds / totalSeconds : 0;
  const totalDots = 5;
  const filledDots = Math.round(progressFraction * totalDots);

  const isAmber = timeRemaining < 600 && timeRemaining >= 300;
  const isRed = timeRemaining < 300;
  const topBarBg = isRed
    ? "var(--danger)"
    : isAmber
    ? "#d97706"
    : "var(--accent-blue, var(--accent))";

  const sessionSend = useCallback(
    (text: string) => sendMessage(text, {
      suppressNavigation: true,
      onStreamStart: startStreamTTS,
      onToken: feedStreamTTS,
      onStreamComplete: endStreamTTS,
    }),
    [sendMessage, startStreamTTS, feedStreamTTS, endStreamTTS]
  );

  const handleVoiceToggle = useCallback(() => {
    if (isVoiceActive) {
      disconnectVoice();
      // Clear live voice transcripts and reload DB-saved messages after a short delay
      setVoiceMessages([]);
      setTimeout(() => { if (apptId) initSessionChat(apptId); }, 1200);
    } else {
      connectVoice(activeSessionId, {
        onUserTranscript: (chunk) => {
          setVoiceMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "user") {
              return [...prev.slice(0, -1), { role: "user", content: last.content + chunk }];
            }
            return [...prev, { role: "user", content: chunk }];
          });
        },
        onAiTranscriptChunk: (chunk) => {
          // Accumulate for QUIZ_OFFER detection on turn complete
          voiceAiTurnRef.current += chunk;
          // Strip marker from visible transcript
          const cleanChunk = chunk.replace(/\[QUIZ_OFFER:\s*topic="[^"]*"\]/gi, "");
          setVoiceMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [...prev.slice(0, -1), { role: "assistant", content: last.content + cleanChunk }];
            }
            return cleanChunk ? [...prev, { role: "assistant", content: cleanChunk }] : prev;
          });
        },
        onTurnComplete: () => {
          const fullAi = voiceAiTurnRef.current;
          voiceAiTurnRef.current = "";
          const match = fullAi.match(/\[QUIZ_OFFER:\s*topic="([^"]+)"\]/i);
          if (match) {
            setVoiceQuizTopic(match[1]);
          }
        },
        onTurnSaved: () => {
          // DB commit confirmed — swap live transcripts into the unified message list
          setVoiceMessages([]);
          if (apptId) initSessionChat(apptId);
        },
        onCreditsUpdate: () => {},
        onSessionCreated: () => {},
        onError: (msg) => console.error("Voice error:", msg),
        onQuizOffer: (topic) => { setVoiceQuizTopic(topic); },
      }, apptId);
    }
  }, [isVoiceActive, connectVoice, disconnectVoice, activeSessionId, apptId, initSessionChat]);

  if (sessionState === "passcode") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="logo-section">
            <img src="/Original-Logo.png" alt="SmartAI Tutor" className="auth-logo" />
            <h1>Join Session</h1>
            <p>Enter the passcode sent to your parent or teacher</p>
          </div>
          <div className="form-group">
            <label>Session Passcode</label>
            <input
              type="text"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              style={{
                textAlign: "center",
                fontSize: 22,
                letterSpacing: 6,
                fontWeight: 700,
                fontFamily: "monospace",
              }}
            />
          </div>
          {joinError && <p className="error-text">{joinError}</p>}
          <button
            className="auth-submit"
            onClick={handleJoin}
            disabled={!passcode.trim()}
          >
            <Lock size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Join Session
          </button>
          <p className="auth-switch" style={{ marginTop: 16 }}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate("/chat"); }}
            >
              Back to Chat
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (sessionState === "ended") {
    return (
      <PostSessionScreen
        appointmentId={apptId}
        sessionTitle={sessionTitle}
        sessionSubject={sessionSubject}
        durationMinutes={durationMinutes}
      />
    );
  }

  const learnPanelInner = (
    <>
      <div style={styles.tabs}>
        {(["learn", "test"] as LearnTab[]).map((tab) => (
          <button
            key={tab}
            style={{
              ...styles.tabBtn,
              ...(learnTab === tab ? styles.tabBtnActive : {}),
            }}
            onClick={() => setLearnTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={styles.learnContent}>
        {isPaused ? (
          <div style={styles.pausedOverlay}>
            <span style={{ fontSize: 32 }}>⏸</span>
            <p style={styles.pausedOverlayText}>Session is paused</p>
            <p style={styles.pausedOverlaySub}>Resume the session to continue learning.</p>
            <button style={styles.pausedResumeBtn} onClick={handlePause}>
              ▶ Resume Session
            </button>
          </div>
        ) : null}
        {!isPaused && learnTab === "learn" && (
          <div style={styles.learnMessagesWrap}>
            <div style={styles.emptyLearn}>
              <span style={{ fontSize: 36 }}>📄</span>
              <p style={styles.emptyLearnText}>
                Lesson content will be shown here.
              </p>
            </div>
          </div>
        )}

        {!isPaused && learnTab === "test" && (
          <div style={{ padding: "16px", position: "relative" }}>
            {testResult ? (
              <div>
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 40 }}>🏅</span>
                  <p style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", margin: "6px 0 4px" }}>Quiz Complete!</p>
                  <div style={{ fontSize: 40, fontWeight: 800, color: testResult.score >= 60 ? "#10b981" : "#f97316", lineHeight: 1, margin: "2px 0 6px" }}>
                    {Math.round(testResult.score)}%
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                    {testResult.totalCorrect} of {testResult.questions.length} correct on <strong style={{ color: "var(--text-primary)" }}>{testResult.topic}</strong>
                  </p>
                </div>
                {/* Score bar */}
                <div style={{ height: 6, background: "var(--border-color)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
                  <div style={{ height: "100%", width: `${testResult.score}%`, background: testResult.score >= 60 ? "#10b981" : "#f97316", borderRadius: 99, transition: "width 0.6s ease" }} />
                </div>
                {/* Areas */}
                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  {testResult.weak.length > 0 && (
                    <div style={{ flex: 1 }}>
                      <p style={styles.chipLabel}>Areas to Improve</p>
                      <div style={styles.chipRow}>
                        {testResult.weak.map((t) => <span key={t} style={styles.weakChip}>{t}</span>)}
                      </div>
                    </div>
                  )}
                  {testResult.strong.length > 0 && (
                    <div style={{ flex: 1 }}>
                      <p style={styles.chipLabel}>Strong Areas</p>
                      <div style={styles.chipRow}>
                        {testResult.strong.map((t) => <span key={t} style={styles.strongChip}>{t}</span>)}
                      </div>
                    </div>
                  )}
                </div>
                {/* Question breakdown */}
                {testResult.questions.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <p style={styles.chipLabel}>Question Breakdown</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {testResult.questions.map((q, i) => (
                        <div key={i} style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: `1px solid ${q.is_correct ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
                          background: q.is_correct ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}>
                          <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{q.is_correct ? "✅" : "❌"}</span>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", margin: 0, lineHeight: 1.45 }}>
                            Q{i + 1}. {q.question_text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={styles.testSavedNote}>Your results have been saved and are visible to your teacher and parent.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  <button style={styles.generateBtn} onClick={() => navigate("/progress")}>View My Progress</button>
                  <button
                    style={{ ...styles.generateBtn, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)" }}
                    onClick={() => { setTestResult(null); setTestAssessment(null); setTestCurrentQ(0); setTestFeedback(null); }}
                  >
                    Back to Learning
                  </button>
                </div>
              </div>
            ) : testAssessment ? (
              <div>
                {/* Progress header */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                      Question {testCurrentQ + 1} of {testAssessment.questions.length}
                    </span>
                    {quizOffer?.topic && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>{quizOffer.topic}</span>
                    )}
                  </div>
                  <div style={{ height: 4, background: "var(--border-color)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(testCurrentQ / testAssessment.questions.length) * 100}%`, background: "var(--accent-blue, var(--accent))", borderRadius: 99, transition: "width 0.4s ease" }} />
                  </div>
                </div>
                {/* Question text */}
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.55, marginBottom: 14 }}>
                  {testAssessment.questions[testCurrentQ].question_text}
                </p>
                {/* Options */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {testAssessment.questions[testCurrentQ].options.map((opt, idx) => {
                    let optStyle: React.CSSProperties = { ...styles.quizOptionBtn };
                    if (testFeedback) {
                      if (testFeedback.correctAnswer !== null && idx === testFeedback.correctAnswer) {
                        optStyle = { ...optStyle, background: "rgba(16,185,129,0.08)", borderColor: "#10b981", color: "#10b981", fontWeight: 700 };
                      } else if (idx === testFeedback.selectedAnswer && !testFeedback.isCorrect) {
                        optStyle = { ...optStyle, background: "rgba(239,68,68,0.08)", borderColor: "#ef4444", color: "#ef4444" };
                      } else {
                        optStyle = { ...optStyle, opacity: 0.4 };
                      }
                    }
                    return (
                      <button key={idx} disabled={!!testFeedback || testAnswering} onClick={() => handleTestAnswer(idx)} style={optStyle}>
                        <span style={{ ...styles.optionLabel, borderColor: testFeedback && testFeedback.correctAnswer === idx ? "#10b981" : testFeedback && testFeedback.selectedAnswer === idx && !testFeedback.isCorrect ? "#ef4444" : "var(--border-color)" }}>
                          {["A","B","C","D"][idx]}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {/* Feedback */}
                {testFeedback && (
                  <div style={{ ...styles.feedbackBox, background: testFeedback.isCorrect ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", borderColor: testFeedback.isCorrect ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: testFeedback.explanation ? 4 : 0 }}>
                      <span style={{ fontSize: 14 }}>{testFeedback.isCorrect ? "✅" : "❌"}</span>
                      <p style={{ fontSize: 13, fontWeight: 700, color: testFeedback.isCorrect ? "#10b981" : "#ef4444", margin: 0 }}>
                        {testFeedback.isCorrect ? "Correct!" : "Not quite."}
                      </p>
                    </div>
                    {testFeedback.explanation && <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>{testFeedback.explanation}</p>}
                  </div>
                )}
                {testFeedback && (
                  <button style={styles.generateBtn} onClick={handleTestNext}>
                    {testCurrentQ + 1 < testAssessment.questions.length ? "Next Question →" : "See Results"}
                  </button>
                )}
                {testError && <p style={{ ...styles.errorText, marginTop: 8 }}>{testError}</p>}
              </div>
            ) : (
              <div style={styles.assessCard}>
                {quizOffer && (
                  <div style={{ padding: "8px 12px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "var(--accent-blue, var(--accent))", fontWeight: 600, textAlign: "center" }}>
                    🤖 Your AI tutor suggested a quiz on <em>{quizOffer.topic}</em>
                  </div>
                )}
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 32 }}>📝</span>
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6, textAlign: "center" }}>Formal Test</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, textAlign: "center", marginBottom: 12 }}>
                  Complete a 10-question test on this session's topic. Results will be saved to your progress record.
                </p>
                <div style={styles.testWarning}>
                  Your score will be recorded and shared with your teacher.
                </div>
                {testError && <p style={{ ...styles.errorText, marginBottom: 10 }}>{testError}</p>}
                {isPaused ? (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 10 }}>Resume session to access the test</p>
                ) : (
                  <button
                    style={{ ...styles.generateBtn, marginTop: 12 }}
                    onClick={() => handleStartTest()}
                    disabled={testLoading}
                  >
                    {testLoading ? "Generating..." : "Start Test"}
                  </button>
                )}
              </div>
            )}
            {playing && (
              <div style={styles.ttsOverlay}>
                <span style={{ fontSize: 36 }}>🔊</span>
                <p style={styles.pausedOverlayText}>AI Tutor is speaking...</p>
                <p style={styles.pausedOverlaySub}>Wait for the lecture to end before taking the test.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  const avatarInner = (
    <>
      <div style={styles.avatarBox}>
        <div style={styles.avatarPulse} className={voiceStatus !== "idle" ? "avatar-pulse-anim" : ""}>
          <span style={styles.avatarEmoji}>🤖</span>
        </div>
        <p style={styles.avatarCaption}>AI Tutor Avatar</p>
        <p style={styles.avatarSub}>Coming Soon</p>
      </div>
      {voiceStatus !== "idle" && (
        <div style={styles.speakingBadge}>
          <span style={styles.speakingDot} />
          AI Tutor is speaking...
        </div>
      )}
    </>
  );

  const chatPanelInner = (
    <>
      <div style={styles.chatPanelHeader}>
        <span style={styles.chatPanelTitle}>Classroom Chat</span>
        <span style={styles.handRaise}>✋ Raise Hand</span>
      </div>

      <div style={styles.quickActions}>
        {(["I need help with this", "Can you explain that again?", "Please go slower"] as const).map((text, i) => (
          <button
            key={i}
            style={{
              ...styles.quickBtn,
              ...(isPaused ? styles.quickBtnDisabled : {}),
            }}
            onClick={() => !isPaused && sessionSend(text)}
            disabled={isPaused}
          >
            {["🙋 I need help", "🔄 Explain again", "🐢 Go slower"][i]}
          </button>
        ))}
      </div>

      <div style={styles.chatMessages}>
        {isPaused && (
          <div style={styles.pausedOverlay}>
            <span style={{ fontSize: 32 }}>⏸</span>
            <p style={styles.pausedOverlayText}>Session is paused</p>
            <p style={styles.pausedOverlaySub}>Resume the session to continue chatting with your AI tutor.</p>
            <button style={styles.pausedResumeBtn} onClick={handlePause}>
              ▶ Resume Session
            </button>
          </div>
        )}
        {!isPaused && messages.length === 0 && !streaming ? (
          <div style={styles.chatEmpty}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              Session is active — ask your AI tutor anything!
            </p>
          </div>
        ) : !isPaused ? (
          <ChatWindow
            messages={displayMessages}
            streaming={streaming}
            streamContent={streamContent}
            onSpeak={speakText}
          />
        ) : null}
      </div>

      <div style={styles.chatInputWrap}>
        <ChatInput
          onSend={sessionSend}
          streaming={streaming}
          onStop={stopStreaming}
          voiceStatus={voiceStatus}
          onVoiceStart={handleVoiceToggle}
          onVoiceEnd={disconnectVoice}
          disabled={isPaused}
        />
      </div>
    </>
  );

  return (
    <div style={styles.root}>
      <div style={{ ...styles.topBar, background: topBarBg }}>
        <div style={styles.topBarLeft}>
          <button
            style={styles.dashboardBtn}
            onClick={() => navigate("/chat")}
            title="Back to Dashboard"
          >
            ← Dashboard
          </button>
          <div style={styles.dotProgress}>
            {Array.from({ length: totalDots }).map((_, i) => (
              <span
                key={i}
                style={{
                  ...styles.dot,
                  background: i < filledDots ? "white" : "rgba(255,255,255,0.35)",
                }}
              />
            ))}
          </div>
          <span style={styles.topBarTitle}>
            {sessionSubject || "Session"}{sessionTitle ? ` · ${sessionTitle}` : ""}
          </span>
        </div>
        <div style={styles.topBarCenter}>
          <span style={styles.timerEmoji}>{isPaused ? "⏸" : "⏱"}</span>
          <span style={{ ...styles.timerText, opacity: isPaused ? 0.6 : 1 }}>{formatTime(timeRemaining)}</span>
          <span style={styles.timerLabel}>{isPaused ? "paused" : "left"}</span>
        </div>
        <div style={styles.topBarRight}>
          <span style={styles.xpChip}>🔥 {xp} XP</span>
          {isPaused && (
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", background: "rgba(255,255,255,0.2)", borderRadius: 99, padding: "3px 10px" }}>
              ⏸ PAUSED
            </span>
          )}
          <button
            style={{ ...styles.endBtn, background: isPaused ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.15)" }}
            onClick={handlePause}
            title={isPaused ? "Resume session" : "Pause session"}
          >
            {isPaused ? <Play size={14} style={{ marginRight: 4 }} /> : <Pause size={14} style={{ marginRight: 4 }} />}
            {isPaused ? "Resume" : "Pause"}
          </button>
          <button
            style={styles.endBtn}
            onClick={handleEndSession}
            title="End session"
          >
            <X size={14} style={{ marginRight: 4 }} />
            End Lesson
          </button>
        </div>
      </div>

      <div style={styles.panels}>
        {isMobile ? (
          <>
            {/* Compact avatar strip */}
            <div style={{
              width: 110,
              flexShrink: 0,
              borderRight: "1px solid var(--border-color)",
              background: "var(--bg-primary)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "14px 8px",
            }}>
              <div style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "rgba(99,102,241,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }} className={voiceStatus !== "idle" ? "avatar-pulse-anim" : ""}>
                <span style={{ fontSize: 34 }}>🤖</span>
              </div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#334155", textAlign: "center", margin: 0, lineHeight: 1.3 }}>
                AI Tutor
              </p>
              <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", borderRadius: 99, padding: "2px 7px", fontWeight: 600 }}>
                Avatar
              </span>
              {voiceStatus !== "idle" && (
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "var(--accent-blue, #3b82f6)",
                  animation: "avatarPulse 1.2s ease-in-out infinite",
                  flexShrink: 0,
                }} />
              )}
            </div>

            {/* Switching content panel */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Mini panel switcher */}
              <div style={{
                display: "flex",
                borderBottom: "2px solid var(--border-color)",
                background: "var(--bg-secondary)",
                flexShrink: 0,
              }}>
                {([
                  { id: "chat", label: "💬 Chat" },
                  { id: "learn", label: "📖 Learn" },
                ] as { id: "chat" | "learn"; label: string }[]).map((tab) => (
                  <button
                    key={tab.id}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      border: "none",
                      background: "transparent",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: mobilePanelView === tab.id ? "var(--accent-blue, #3b82f6)" : "var(--text-muted)",
                      borderBottom: mobilePanelView === tab.id ? "2px solid var(--accent-blue, #3b82f6)" : "2px solid transparent",
                      marginBottom: -2,
                      transition: "color 0.15s, border-color 0.15s",
                      fontFamily: "inherit",
                    }}
                    onClick={() => setMobilePanelView(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Panel content */}
              {mobilePanelView === "chat" ? (
                <div style={{ ...styles.chatPanel, flex: 1 }}>
                  {chatPanelInner}
                </div>
              ) : (
                <div style={{ ...styles.learnPanel, width: "auto", flex: 1, borderRight: "none" }}>
                  {learnPanelInner}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={styles.learnPanel}>
              {learnPanelInner}
            </div>
            <div style={styles.avatarPanel}>
              {avatarInner}
            </div>
            <div style={styles.chatPanel}>
              {chatPanelInner}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes avatarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.3); }
          50% { box-shadow: 0 0 0 18px rgba(99,102,241,0); }
        }
        .avatar-pulse-anim {
          animation: avatarPulse 2.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg-primary)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    height: 52,
    color: "white",
    flexShrink: 0,
    transition: "background 0.5s",
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  dashboardBtn: {
    display: "flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 8,
    color: "white",
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  dotProgress: {
    display: "flex",
    gap: 5,
    flexShrink: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
    transition: "background 0.4s",
  },
  topBarTitle: {
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  topBarCenter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: "0 0 auto",
  },
  timerEmoji: {
    fontSize: 16,
  },
  timerText: {
    fontSize: 22,
    fontFamily: "monospace",
    fontWeight: 700,
    letterSpacing: 1,
  },
  timerLabel: {
    fontSize: 11,
    opacity: 0.8,
    marginLeft: 2,
  },
  topBarRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    justifyContent: "flex-end",
  },
  xpChip: {
    background: "rgba(255,255,255,0.2)",
    borderRadius: 99,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  endBtn: {
    display: "flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 8,
    color: "white",
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  panels: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  learnPanel: {
    width: "35%",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border-color)",
    background: "var(--bg-secondary)",
    overflow: "hidden",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid var(--border-color)",
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1,
    padding: "10px 0",
    border: "none",
    background: "transparent",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-muted)",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    transition: "color 0.15s, border-color 0.15s",
  },
  tabBtnActive: {
    color: "var(--accent-blue, var(--accent))",
    borderBottom: "2px solid var(--accent-blue, var(--accent))",
  },
  learnContent: {
    flex: 1,
    overflowY: "auto",
  },
  learnMessagesWrap: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  learnMessages: {
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyLearn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
    textAlign: "center",
  },
  emptyLearnText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.6,
  },
  emptyTab: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    gap: 12,
    textAlign: "center",
  },
  emptyTabText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.6,
    maxWidth: 200,
  },
  avatarPanel: {
    width: "30%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid var(--border-color)",
    background: "var(--bg-primary)",
    gap: 16,
    padding: 20,
  },
  avatarBox: {
    width: 300,
    maxWidth: "100%",
    height: 400,
    background: "#f1f5f9",
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "2px dashed #cbd5e1",
  },
  avatarPulse: {
    width: 100,
    height: 100,
    borderRadius: "50%",
    background: "rgba(99,102,241,0.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "avatarPulse 2.4s ease-in-out infinite",
  },
  avatarEmoji: {
    fontSize: 52,
  },
  avatarCaption: {
    fontSize: 15,
    fontWeight: 700,
    color: "#334155",
    margin: "4px 0 0",
  },
  avatarSub: {
    fontSize: 12,
    color: "#94a3b8",
    background: "#fef3c7",
    borderRadius: 99,
    padding: "2px 10px",
    fontWeight: 600,
  },
  speakingBadge: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 14px",
    background: "rgba(99,102,241,0.1)",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent-blue, var(--accent))",
    border: "1px solid rgba(99,102,241,0.2)",
  },
  speakingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--accent-blue, var(--accent))",
    display: "inline-block",
    animation: "avatarPulse 1.2s ease-in-out infinite",
  },
  chatPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--bg-secondary)",
  },
  chatPanelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid var(--border-color)",
    flexShrink: 0,
  },
  chatPanelTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  handRaise: {
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-tertiary)",
    padding: "3px 10px",
    borderRadius: 99,
    border: "1px solid var(--border-color)",
    cursor: "pointer",
    userSelect: "none",
  },
  quickActions: {
    display: "flex",
    gap: 6,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-color)",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  quickBtn: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 99,
    padding: "4px 10px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.15s, color 0.15s",
  },
  chatMessages: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  chatEmpty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  pausedOverlay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "40px 24px",
    textAlign: "center",
    flex: 1,
  },
  pausedOverlayText: {
    fontSize: 16,
    fontWeight: 700,
    color: "#374151",
    margin: 0,
  },
  pausedOverlaySub: {
    fontSize: 13,
    color: "#94a3b8",
    margin: 0,
    maxWidth: 240,
    lineHeight: 1.5,
  },
  pausedResumeBtn: {
    marginTop: 8,
    background: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  quickBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  chatInputWrap: {
    flexShrink: 0,
  },
  assessCard: {
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 10,
    padding: "16px",
  },
  generateBtn: {
    width: "100%",
    padding: "10px 16px",
    background: "var(--accent-blue, var(--accent))",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center" as const,
  },
  optionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 12px",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text-primary)",
    textAlign: "left" as const,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  quizOptionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "11px 14px",
    background: "var(--bg-primary)",
    border: "1.5px solid var(--border-color)",
    borderRadius: 10,
    fontSize: 13,
    color: "var(--text-primary)",
    textAlign: "left" as const,
    cursor: "pointer",
    transition: "all 0.15s",
    fontWeight: 500,
  },
  optionLabel: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0 as const,
    color: "inherit",
  },
  feedbackBox: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid",
  },
  reportBox: {
    padding: "10px 12px",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    marginBottom: 4,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color: "var(--text-muted)",
    marginBottom: 6,
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 5,
  },
  weakChip: {
    padding: "2px 8px",
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(239,68,68,0.1)",
    color: "#ef4444",
    border: "1px solid rgba(239,68,68,0.2)",
  },
  strongChip: {
    padding: "2px 8px",
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(16,185,129,0.1)",
    color: "#10b981",
    border: "1px solid rgba(16,185,129,0.2)",
  },
  testWarning: {
    padding: "8px 12px",
    background: "rgba(245,158,11,0.1)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 8,
    fontSize: 12,
    color: "#92400e",
    fontWeight: 600,
    textAlign: "center" as const,
  },
  testSavedNote: {
    padding: "8px 12px",
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
    textAlign: "center" as const,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    textAlign: "center" as const,
    margin: 0,
  },
  ttsOverlay: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "40px 24px",
    textAlign: "center" as const,
    background: "rgba(248, 250, 252, 0.88)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 10,
  },
};
