import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Clock, Lock, ArrowLeft } from "lucide-react";
import { appointmentsApi } from "../services/api";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import type { ChatMessage } from "../types";

type SessionState = "passcode" | "active" | "ended";

export default function SessionPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const [sessionState, setSessionState] = useState<SessionState>("passcode");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionSubject, setSessionSubject] = useState("");
  const timerRef = useRef<number | null>(null);

  const {
    messages, streaming, streamContent, sendMessage, stopStreaming,
    loadChats, startNewChat, activeSessionId,
  } = useChat();

  const { voiceStatus, connectVoice, disconnectVoice, speakText } = useVoice();

  const handleJoin = async () => {
    if (!appointmentId) return;
    setError("");
    try {
      const result = await appointmentsApi.joinSession(parseInt(appointmentId), passcode) as any;
      setSessionStartedAt(result.session_started_at);
      setDurationMinutes(result.duration_minutes);
      setSessionTitle(result.title);
      setSessionSubject(result.subject);
      setSessionState("active");
      startNewChat();
    } catch (err: any) {
      setError(err.message || "Invalid passcode");
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

  const isLow = timeRemaining < 300;

  if (sessionState === "passcode") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="logo-section">
            <img src="/Original-Logo.png" alt="SmartAI Tutor" className="auth-logo" />
            <h1>Join Session</h1>
            <p>Enter the passcode provided by your teacher or parent</p>
          </div>
          <div className="form-group">
            <label>Session Passcode</label>
            <input
              type="text"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter passcode"
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              style={{ textAlign: "center", fontSize: 18, letterSpacing: 3 }}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="auth-submit" onClick={handleJoin} disabled={!passcode}>
            <Lock size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Join Session
          </button>
          <p className="auth-switch" style={{ marginTop: 16 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); navigate("/chat"); }}>Back to Chat</a>
          </p>
        </div>
      </div>
    );
  }

  if (sessionState === "ended") {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="logo-section">
            <img src="/Original-Logo.png" alt="SmartAI Tutor" className="auth-logo" />
            <h1>Session Ended</h1>
            <p>Your {durationMinutes}-minute tutoring session is complete.</p>
          </div>
          <div style={{ margin: "20px 0", padding: 16, background: "var(--bg-primary)", borderRadius: "var(--radius)" }}>
            <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              Session: <strong>{sessionTitle}</strong><br />
              Subject: <strong>{sessionSubject}</strong>
            </p>
          </div>
          <button className="auth-submit" onClick={() => navigate("/chat")}>
            <ArrowLeft size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px", background: isLow ? "var(--danger)" : "var(--accent)",
        color: "white", fontSize: 14, fontWeight: 600,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Clock size={16} />
          <span>{sessionTitle} - {sessionSubject}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20, fontFamily: "monospace" }}>{formatTime(timeRemaining)}</span>
          <span style={{ fontSize: 12, opacity: 0.8 }}>remaining</span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.length === 0 && !streaming && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              <img src="/Original-Logo.png" alt="" style={{ width: 60, marginBottom: 12 }} />
              <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Session Active</p>
              <p style={{ fontSize: 13 }}>Ask your tutor anything about {sessionSubject}</p>
            </div>
          )}
          <ChatWindow messages={messages} streaming={streaming} streamContent={streamContent} onSpeak={speakText} />
        </div>

        <ChatInput
          onSend={sendMessage}
          streaming={streaming}
          onStop={stopStreaming}
          voiceStatus={voiceStatus}
          onVoiceStart={() => {}}
          onVoiceEnd={() => {}}
        />
      </div>
    </div>
  );
}
