import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { X, BookOpen } from "lucide-react";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import AssessmentMode from "../components/AssessmentMode";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { appointmentsApi } from "../services/api";
import type { ChatMessage, Assessment, Appointment } from "../types";

// Derive a subject theme from a chat session title/topic text
const CHAT_SUBJECT_THEMES: { keywords: string[]; color: string; bg: string; icon: string }[] = [
  { keywords: ["math", "maths", "algebra", "calculus", "geometry", "trigonometry", "number"], color: "#f97316", bg: "rgba(249,115,22,0.05)", icon: "🧮" },
  { keywords: ["biology", "cells", "genetics", "ecology", "organism", "evolution"],           color: "#22c55e", bg: "rgba(34,197,94,0.05)",  icon: "🧬" },
  { keywords: ["chemistry", "element", "reaction", "compound", "acid", "molecule"],           color: "#ec4899", bg: "rgba(236,72,153,0.05)", icon: "⚗️" },
  { keywords: ["physics", "force", "energy", "wave", "motion", "gravity"],                    color: "#06b6d4", bg: "rgba(6,182,212,0.05)",  icon: "⚛️" },
  { keywords: ["english", "literature", "poem", "essay", "grammar", "shakespeare", "novel"],  color: "#3b82f6", bg: "rgba(59,130,246,0.05)", icon: "📚" },
  { keywords: ["history", "war", "empire", "revolution", "ancient", "century"],               color: "#a855f7", bg: "rgba(168,85,247,0.05)", icon: "🏛️" },
  { keywords: ["geography", "climate", "continent", "country", "map", "biome"],               color: "#10b981", bg: "rgba(16,185,129,0.05)", icon: "🌍" },
  { keywords: ["art", "painting", "drawing", "colour", "design", "artist"],                   color: "#f59e0b", bg: "rgba(245,158,11,0.05)", icon: "🎨" },
  { keywords: ["computer", "computing", "algorithm", "code", "programming", "software"],      color: "#6366f1", bg: "rgba(99,102,241,0.05)", icon: "💻" },
];

function detectSubjectTheme(text: string): { color: string; bg: string; icon: string } | null {
  const lower = text.toLowerCase();
  for (const theme of CHAT_SUBJECT_THEMES) {
    if (theme.keywords.some((k) => lower.includes(k))) return theme;
  }
  return null;
}

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  const {
    messages,
    chatList,
    activeSessionId,
    streaming,
    streamContent,
    credits,
    quizOffer,
    loadChats,
    loadCredits,
    loadChat,
    startNewChat,
    sendMessage,
    deleteChat,
    stopStreaming,
    clearQuizOffer,
  } = useChat();

  const {
    voiceStatus,
    isVoiceActive,
    voiceError,
    clearVoiceError,
    connectVoice,
    disconnectVoice,
    speakText,
  } = useVoice();

  const [voiceMessages, setVoiceMessages] = useState<ChatMessage[]>([]);
  const [voiceAiStream, setVoiceAiStream] = useState("");
  const userTranscriptRef = useRef("");
  const voiceSessionRef = useRef<string | null>(null);
  const [studentAppointments, setStudentAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    loadCredits();
    loadChats();
    appointmentsApi.list().then((data) => setStudentAppointments(data as Appointment[])).catch(() => {});
  }, [loadCredits, loadChats]);

  useEffect(() => {
    if (sessionId && sessionId !== activeSessionId) {
      loadChat(sessionId);
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const location = useLocation();

  useEffect(() => {
    const prompt = (location.state as { prompt?: string } | null)?.prompt;
    if (prompt) {
      navigate(location.pathname, { replace: true, state: {} });
      sendMessage(prompt);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceStart = useCallback(() => {
    setVoiceMessages([]);
    setVoiceAiStream("");
    userTranscriptRef.current = "";
    voiceSessionRef.current = activeSessionId;

    connectVoice(activeSessionId, {
      onUserTranscript: (chunk) => {
        userTranscriptRef.current += chunk;
        setVoiceMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "user" && last.id === -1) {
            return [...prev.slice(0, -1), { ...last, content: userTranscriptRef.current }];
          }
          return [...prev, {
            id: -1,
            chat_id: 0,
            role: "user" as const,
            content: userTranscriptRef.current,
            timestamp: new Date().toISOString(),
          }];
        });
      },
      onAiTranscriptChunk: (chunk) => {
        setVoiceAiStream((prev) => prev + chunk);
      },
      onTurnComplete: () => {
        setVoiceAiStream((current) => {
          if (current.trim()) {
            setVoiceMessages((prev) => [
              ...prev,
              {
                id: Date.now() + 1,
                chat_id: 0,
                role: "assistant" as const,
                content: current,
                timestamp: new Date().toISOString(),
              },
            ]);
          }
          return "";
        });
        setVoiceMessages((prev) =>
          prev.map((m) => (m.id === -1 ? { ...m, id: Date.now() - 1 } : m))
        );
        userTranscriptRef.current = "";
      },
      onCreditsUpdate: () => {
        loadCredits();
      },
      onSessionCreated: (sid) => {
        voiceSessionRef.current = sid;
        navigate(`/chat/${sid}`, { replace: true });
        loadChats();
      },
      onError: () => {},
    });
  }, [activeSessionId, connectVoice, navigate, loadChats, loadCredits]);

  const handleVoiceEnd = useCallback(() => {
    disconnectVoice();
    const sid = voiceSessionRef.current || activeSessionId;
    if (sid) {
      loadChat(sid);
    }
    loadChats();
    setVoiceMessages([]);
    setVoiceAiStream("");
    userTranscriptRef.current = "";
    voiceSessionRef.current = null;
  }, [disconnectVoice, activeSessionId, loadChat, loadChats]);

  const allMessages = isVoiceActive ? [...messages, ...voiceMessages] : messages;
  const currentStreamContent = isVoiceActive ? voiceAiStream : streamContent;
  const isStreaming = isVoiceActive ? voiceAiStream.length > 0 : streaming;

  // Detect subject theme from active chat messages
  const activeSession = chatList.find((c) => c.session_id === activeSessionId);
  const themeSource = [
    activeSession?.title ?? "",
    allMessages.find((m) => m.role === "user")?.content ?? "",
    allMessages.find((m) => m.role === "assistant")?.content ?? "",
  ].join(" ");
  const subjectTheme = themeSource.trim() ? detectSubjectTheme(themeSource) : null;

  return (
    <div className="app-layout">
      <Sidebar
        chatList={chatList}
        activeSessionId={activeSessionId}
        credits={credits}
        appointments={studentAppointments}
        onNewChat={startNewChat}
        onSelectChat={loadChat}
        onDeleteChat={deleteChat}
        onLoadChats={loadChats}
      />

      <div className="main-content" style={{
        background: subjectTheme ? subjectTheme.bg : undefined,
        transition: "background 0.4s ease",
      }}>
        {/* Subject-themed header strip — shown when subject detected */}
        {subjectTheme && activeSession && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 20px",
            background: `linear-gradient(135deg, ${subjectTheme.color}14, ${subjectTheme.color}08)`,
            borderBottom: `1px solid ${subjectTheme.color}22`,
            flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: `${subjectTheme.color}18`,
              border: `1.5px solid ${subjectTheme.color}33`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, flexShrink: 0,
            }}>{subjectTheme.icon}</div>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: subjectTheme.color,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{activeSession.title}</span>
            <div style={{
              marginLeft: "auto",
              fontSize: 10, color: subjectTheme.color,
              background: `${subjectTheme.color}14`,
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 700,
            }}>AI Tutor Active</div>
            <img
              src={
                ["biology", "chemistry", "physics"].some((k) =>
                  activeSession.title.toLowerCase().includes(k)
                ) || themeSource.toLowerCase().includes("science")
                  ? "/images/sci-robot.png"
                  : "/images/robotAI.png"
              }
              alt="Subject robot"
              draggable={false}
              style={{
                height: 60,
                width: "auto",
                objectFit: "contain",
                pointerEvents: "none",
                flexShrink: 0,
              }}
            />
          </div>
        )}
        <div className="chat-container">
          {allMessages.length === 0 && !isStreaming && (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "32px 24px", gap: 24, textAlign: "center",
            }}>
              <style>{`
                @keyframes cp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
                @keyframes cp-pop { from{opacity:0;transform:scale(0.88) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
                .cp-suggestion { background:#fff; border:1.5px solid #e5e7eb; border-radius:14px; padding:14px 16px; cursor:pointer; text-align:left; transition:all 0.18s ease; animation: cp-pop 0.35s ease both; }
                .cp-suggestion:hover { border-color:#6366f1; box-shadow:0 4px 18px rgba(99,102,241,0.13); transform:translateY(-2px); }
                .cp-subject-pill { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:6px 14px; font-size:13px; font-weight:700; cursor:pointer; border:none; transition:all 0.18s; }
                .cp-subject-pill:hover { transform:translateY(-2px); filter:brightness(1.08); }
              `}</style>

              {/* Robot illustration */}
              <div style={{ animation: "cp-float 3.5s ease-in-out infinite", flexShrink: 0 }}>
                <img src="/images/teaching-robot.png" alt="AI Tutor" draggable={false}
                  style={{ width: 130, height: 130, objectFit: "contain", pointerEvents: "none",
                    filter: "drop-shadow(0 8px 24px rgba(99,102,241,0.25))" }} />
              </div>

              {/* Heading */}
              <div>
                <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#1e1b4b" }}>
                  Ask me anything! 🤖✨
                </h2>
                <p style={{ margin: 0, fontSize: 14, color: "#6b7280", maxWidth: 380 }}>
                  Quick questions, homework help, or explore a topic.
                </p>
              </div>

              {/* Start a structured lesson shortcut */}
              <button
                onClick={() => navigate("/lesson/setup")}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", borderRadius: 999,
                  background: "linear-gradient(135deg, #1a73e8, #6366f1)",
                  color: "#fff", border: "none", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", boxShadow: "0 4px 14px rgba(26,115,232,0.3)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(26,115,232,0.4)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 14px rgba(26,115,232,0.3)"; }}
              >
                <BookOpen size={14} />
                Start a structured lesson →
              </button>

              {/* Subject quick-starters */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480 }}>
                {[
                  { label: "🧮 Maths",    color: "#f97316", bg: "#fff7ed", prompt: "Help me with a maths problem" },
                  { label: "🔬 Science",  color: "#22c55e", bg: "#f0fdf4", prompt: "Explain a science concept" },
                  { label: "📚 English",  color: "#3b82f6", bg: "#eff6ff", prompt: "Help me improve my English writing" },
                  { label: "🧬 Biology",  color: "#10b981", bg: "#ecfdf5", prompt: "Tell me about biology and living things" },
                  { label: "⚗️ Chemistry",color: "#ec4899", bg: "#fdf2f8", prompt: "Explain a chemistry topic" },
                  { label: "🏛️ History",  color: "#a855f7", bg: "#faf5ff", prompt: "Teach me about a historical event" },
                ].map((s, i) => (
                  <button key={s.label} className="cp-subject-pill"
                    style={{ background: s.bg, color: s.color, border: `1.5px solid ${s.color}33`,
                      animationDelay: `${i * 0.05}s` }}
                    onClick={() => sendMessage(s.prompt)}>
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Suggested prompts */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%", maxWidth: 560 }}>
                {[
                  { icon: "💡", title: "Explain a concept", body: "Explain photosynthesis in simple terms", delay: "0.1s" },
                  { icon: "📝", title: "Help with homework", body: "Help me solve: 3x + 7 = 22", delay: "0.15s" },
                  { icon: "🧪", title: "Science experiment", body: "What happens when you mix vinegar and baking soda?", delay: "0.2s" },
                  { icon: "📖", title: "Essay writing",     body: "Help me write an introduction for an essay about climate change", delay: "0.25s" },
                ].map((p) => (
                  <button key={p.title} className="cp-suggestion"
                    style={{ animationDelay: p.delay }}
                    onClick={() => sendMessage(p.body)}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{p.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 2 }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>{p.body}</div>
                  </button>
                ))}
              </div>

              <p style={{ margin: 0, fontSize: 11, color: "#374151" }}>
                🔒 AI can make mistakes — always verify important information.
              </p>
            </div>
          )}
          <ChatWindow
            messages={allMessages}
            streaming={isStreaming}
            streamContent={currentStreamContent}
            onSpeak={speakText}
          />
        </div>

        {voiceError && (
          <div className="voice-error-bar">
            <span>{voiceError}</span>
            <button onClick={clearVoiceError} className="voice-error-close">
              <X size={14} />
            </button>
          </div>
        )}

        {quizOffer ? (
          <AssessmentMode
            quizOffer={quizOffer}
            onComplete={(assessment: Assessment) => {
              clearQuizOffer();
              const reportMsg: ChatMessage = {
                id: Date.now(),
                chat_id: 0,
                role: "assistant",
                content: `**Quiz Complete: ${assessment.topic}**\n\nScore: ${assessment.score_percent.toFixed(0)}%\n${assessment.report_text || ""}`,
                timestamp: new Date().toISOString(),
              };
              // The assessment is saved in DB. Just show the result in chat.
            }}
            onDecline={clearQuizOffer}
          />
        ) : (
          <ChatInput
            onSend={sendMessage}
            streaming={streaming}
            onStop={stopStreaming}
            voiceStatus={voiceStatus}
            onVoiceStart={handleVoiceStart}
            onVoiceEnd={handleVoiceEnd}
          />
        )}
      </div>
    </div>
  );
}
