import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Lock, X } from "lucide-react";
import { appointmentsApi } from "../services/api";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import AssessmentMode from "../components/AssessmentMode";
import PostSessionScreen from "../components/PostSessionScreen";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { useAuth } from "../context/AuthContext";

type SessionState = "passcode" | "active" | "ended";
type LearnTab = "learn" | "practice" | "test";

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
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionSubject, setSessionSubject] = useState("");
  const [learnTab, setLearnTab] = useState<LearnTab>("learn");
  const [xp] = useState(125);
  const timerRef = useRef<number | null>(null);

  const {
    messages, streaming, streamContent, sendMessage, stopStreaming,
    resetChat, activeSessionId, quizOffer, clearQuizOffer,
  } = useChat();

  const { voiceStatus, speakText } = useVoice();

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
      setSessionState("active");
      resetChat();
    } catch (err: any) {
      setJoinError(err.message || "Invalid passcode");
    }
  };

  useEffect(() => {
    if (sessionState !== "active" || !sessionStartedAt) return;

    const updateTimer = () => {
      const start = new Date(sessionStartedAt).getTime();
      const end = start + durationMinutes * 60 * 1000;
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        setSessionState("ended");
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };

    updateTimer();
    timerRef.current = window.setInterval(updateTimer, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionState, sessionStartedAt, durationMinutes]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

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
    (text: string) => sendMessage(text, { suppressNavigation: true }),
    [sendMessage]
  );

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

  return (
    <div style={styles.root}>
      <div style={{ ...styles.topBar, background: topBarBg }}>
        <div style={styles.topBarLeft}>
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
          <span style={styles.timerEmoji}>⏱</span>
          <span style={styles.timerText}>{formatTime(timeRemaining)}</span>
          <span style={styles.timerLabel}>left</span>
        </div>
        <div style={styles.topBarRight}>
          <span style={styles.xpChip}>🔥 {xp} XP</span>
          <button
            style={styles.endBtn}
            onClick={() => setSessionState("ended")}
            title="End session"
          >
            <X size={14} style={{ marginRight: 4 }} />
            End Lesson
          </button>
        </div>
      </div>

      <div style={styles.panels}>
        <div style={styles.learnPanel}>
          <div style={styles.tabs}>
            {(["learn", "practice", "test"] as LearnTab[]).map((tab) => (
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
            {learnTab === "learn" && (
              <div style={styles.learnMessagesWrap}>
                {messages.length === 0 && !streaming ? (
                  <div style={styles.emptyLearn}>
                    <span style={{ fontSize: 36 }}>📖</span>
                    <p style={styles.emptyLearnText}>
                      Your lesson on <strong>{sessionSubject}</strong> will appear here as the AI tutor teaches.
                    </p>
                  </div>
                ) : (
                  <div style={styles.learnMessages}>
                    <ChatWindow
                      messages={messages}
                      streaming={streaming}
                      streamContent={streamContent}
                      onSpeak={speakText}
                    />
                  </div>
                )}
              </div>
            )}

            {learnTab === "practice" && (
              <div>
                {quizOffer ? (
                  <AssessmentMode
                    quizOffer={quizOffer}
                    onComplete={() => clearQuizOffer()}
                    onDecline={() => clearQuizOffer()}
                  />
                ) : (
                  <div style={styles.emptyTab}>
                    <span style={{ fontSize: 36 }}>🎯</span>
                    <p style={styles.emptyTabText}>
                      Practice questions will appear here when your AI tutor suggests a quiz.
                    </p>
                  </div>
                )}
              </div>
            )}

            {learnTab === "test" && (
              <div style={styles.emptyTab}>
                <span style={{ fontSize: 36 }}>📝</span>
                <p style={styles.emptyTabText}>
                  Test mode — coming soon. Complete the lesson first!
                </p>
              </div>
            )}
          </div>
        </div>

        <div style={styles.avatarPanel}>
          <div style={styles.avatarBox}>
            <div style={styles.avatarPulse}>
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
        </div>

        <div style={styles.chatPanel}>
          <div style={styles.chatPanelHeader}>
            <span style={styles.chatPanelTitle}>Classroom Chat</span>
            <span style={styles.handRaise}>✋ Raise Hand</span>
          </div>

          <div style={styles.quickActions}>
            <button
              style={styles.quickBtn}
              onClick={() => sessionSend("I need help with this")}
            >
              🙋 I need help
            </button>
            <button
              style={styles.quickBtn}
              onClick={() => sessionSend("Can you explain that again?")}
            >
              🔄 Explain again
            </button>
            <button
              style={styles.quickBtn}
              onClick={() => sessionSend("Please go slower")}
            >
              🐢 Go slower
            </button>
          </div>

          <div style={styles.chatMessages}>
            {messages.length === 0 && !streaming ? (
              <div style={styles.chatEmpty}>
                <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
                  Session is active — ask your AI tutor anything!
                </p>
              </div>
            ) : (
              <ChatWindow
                messages={messages}
                streaming={streaming}
                streamContent={streamContent}
                onSpeak={speakText}
              />
            )}
          </div>

          <div style={styles.chatInputWrap}>
            <ChatInput
              onSend={sessionSend}
              streaming={streaming}
              onStop={stopStreaming}
              voiceStatus={voiceStatus}
              onVoiceStart={() => {}}
              onVoiceEnd={() => {}}
            />
          </div>
        </div>
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
  chatInputWrap: {
    flexShrink: 0,
  },
};
