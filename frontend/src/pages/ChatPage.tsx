import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { X, BookOpen } from "lucide-react";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import { useSessionChannel } from "../hooks/useSessionChannel";
import { useVoiceCapture } from "../hooks/useVoiceCapture";
import { useVoice } from "../hooks/useVoice";
import { chatApi, appointmentsApi, chatWsUrl } from "../services/api";
import type { ChatMessage, ChatListItem, Chat, Appointment } from "../types";

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

type SendOpts = { imageData?: string; imageMime?: string; fileName?: string; research?: boolean };

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // ── sidebar / chat-list / credits (managed directly; messages live in the channel) ──
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [studentAppointments, setStudentAppointments] = useState<Appointment[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [researchEnabled, setResearchEnabled] = useState(false);

  const { speakText } = useVoice();

  const loadChats = useCallback(async () => {
    try { setChatList((await chatApi.listChats()) as ChatListItem[]); } catch { /* ignore */ }
  }, []);
  const loadCredits = useCallback(async () => {
    try { setCredits((await chatApi.getCredits()).credits); } catch { /* ignore */ }
  }, []);

  // ── simple-chat pipeline (text + voice on one WebSocket: /api/chat/ws) ──
  // No socket is opened (and no chat row is created) until the user actually
  // sends the first message from a fresh /chat. A queued send is flushed once
  // the socket reports `ready` with the new chat's id.
  const connectedSidRef = useRef<string | null>(null);
  const sessionIdParamRef = useRef<string | null>(sessionId ?? null);
  const pendingSendRef = useRef<{ text: string; opts: SendOpts } | null>(null);
  const sendMessageRef = useRef<(t: string, o?: SendOpts) => void>(() => {});
  const queueSendRef = useRef<(t: string, o: SendOpts) => void>(() => {});

  const channel = useSessionChannel({
    buildUrl: chatWsUrl,
    // Backend forces text→no-TTS and voice→TTS by message type; `true` lets the
    // voice-mode audio segments actually play on the client.
    ttsEnabled: true,
    onReady: (sid) => {
      connectedSidRef.current = sid;
      if (!sessionIdParamRef.current) {
        // brand-new chat created server-side on first send — adopt its id in the URL
        sessionIdParamRef.current = sid;
        navigate(`/chat/${sid}`, { replace: true });
      }
      // flush the message typed on the fresh /chat screen (sidebar refreshes after the turn)
      const pending = pendingSendRef.current;
      if (pending) {
        pendingSendRef.current = null;
        sendMessageRef.current(pending.text, pending.opts);
      }
    },
    onCredits: (v) => setCredits(v),
    onTool: () => { /* web_search / deep_research results are folded into the streamed answer */ },
  });
  const {
    messages, liveText, fillerText, busy, status: liveStatus,
    sendMessage, sendAudio, stopTurn, hydrate, setMessages, disconnect, resume, error, clearError,
  } = channel;
  sendMessageRef.current = sendMessage;

  // Hands-free voice: capture the utterance and send it over the SAME chat socket
  // as `user_audio` (STT in → spoken reply out). Mic pauses while a turn runs.
  useVoiceCapture({
    active: voiceActive,
    paused: busy,
    onUtterance: (b64, mime) => sendAudio(b64, mime),
    onError: (msg) => { console.warn(msg); setVoiceActive(false); },
  });

  const voiceUiStatus: "idle" | "connecting" | "listening" | "processing" | "speaking" = !voiceActive
    ? "idle"
    : liveStatus === "speaking"
    ? "speaking"
    : busy
    ? "processing"
    : "listening";

  // initial loads
  useEffect(() => {
    void loadCredits();
    void loadChats();
    appointmentsApi.list().then((d) => setStudentAppointments(d as Appointment[])).catch(() => {});
  }, [loadCredits, loadChats]);

  // a one-shot prompt passed via navigation state → send it (connecting if needed)
  useEffect(() => {
    const p = (location.state as { prompt?: string } | null)?.prompt;
    if (p) {
      navigate(location.pathname, { replace: true, state: {} });
      queueSendRef.current(p, {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect only for an EXISTING chat (/chat/:id). A fresh /chat opens no socket
  // and creates no chat row until the user sends (handled in queueSend/onReady).
  useEffect(() => {
    sessionIdParamRef.current = sessionId ?? null;
    if (!sessionId) {
      if (connectedSidRef.current !== null) { disconnect(); connectedSidRef.current = null; }
      pendingSendRef.current = null;
      setMessages([]);
      return;
    }
    if (sessionId === connectedSidRef.current) return; // already on this chat
    disconnect();
    connectedSidRef.current = sessionId;
    chatApi.getChat(sessionId)
      .then((c) => hydrate((c as Chat).messages))
      .catch(() => setMessages([]));
    resume(sessionId);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // refresh credits + chat list (title) at the end of each turn
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (prevBusyRef.current && !busy) { void loadCredits(); void loadChats(); }
    prevBusyRef.current = busy;
  }, [busy, loadCredits, loadChats]);

  // ── chat management ──
  const handleSelectChat = useCallback((sid: string) => { navigate(`/chat/${sid}`); }, [navigate]);
  const handleNewChat = useCallback(() => { navigate("/chat"); }, [navigate]);
  const handleDeleteChat = useCallback(async (sid: string) => {
    try { await chatApi.deleteChat(sid); } catch { /* ignore */ }
    if (sid === sessionId) navigate("/chat");
    await loadChats();
  }, [sessionId, navigate, loadChats]);

  // Send if connected; otherwise queue + open the socket (which creates the chat),
  // and onReady flushes the queued message → no empty chats from just visiting /chat.
  const queueSend = useCallback((text: string, opts: SendOpts) => {
    if (channel.connected) {
      sendMessage(text, opts);
    } else {
      pendingSendRef.current = { text, opts };
      resume(null);
    }
  }, [channel.connected, sendMessage, resume]);
  queueSendRef.current = queueSend;

  const handleSend = useCallback((
    text: string,
    opts?: { imageData?: string; imageMime?: string; fileName?: string; webSearch?: boolean; research?: boolean },
  ) => {
    queueSend(text, {
      imageData: opts?.imageData,
      imageMime: opts?.imageMime,
      fileName: opts?.fileName,
      research: opts?.research ?? researchEnabled,
    });
  }, [queueSend, researchEnabled]);

  const handleVoiceStart = useCallback(() => setVoiceActive(true), []);
  const handleVoiceEnd = useCallback(() => setVoiceActive(false), []);

  const showWelcome = messages.length === 0 && !busy && !liveText;

  // subject theme from active chat
  const activeSession = chatList.find((c) => c.session_id === sessionId);
  const themeSource = [
    activeSession?.title ?? "",
    messages.find((m) => m.role === "user")?.content ?? "",
    messages.find((m) => m.role === "assistant")?.content ?? "",
  ].join(" ");
  const subjectTheme = themeSource.trim() ? detectSubjectTheme(themeSource) : null;

  return (
    <div className="app-layout">
      <Sidebar
        chatList={chatList}
        activeSessionId={sessionId ?? null}
        credits={credits}
        appointments={studentAppointments}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
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
          {showWelcome && (
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
                    onClick={() => handleSend(s.prompt)}>
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
                    onClick={() => handleSend(p.body)}>
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
            messages={messages}
            streaming={false}
            streamContent=""
            onSpeak={speakText}
            liveText={liveText}
            liveStatus={liveStatus}
            fillerText={fillerText}
          />
        </div>

        {error && (
          <div className="voice-error-bar">
            <span>{error}</span>
            <button onClick={clearError} className="voice-error-close">
              <X size={14} />
            </button>
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          streaming={busy}
          onStop={stopTurn}
          voiceStatus={voiceUiStatus}
          onVoiceStart={handleVoiceStart}
          onVoiceEnd={handleVoiceEnd}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={() => setWebSearchEnabled((v) => !v)}
          researchEnabled={researchEnabled}
          onResearchToggle={() => setResearchEnabled((v) => !v)}
        />
      </div>
    </div>
  );
}
