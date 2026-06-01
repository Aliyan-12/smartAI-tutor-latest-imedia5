import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Volume2, ChevronDown } from "lucide-react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  streamContent: string;
  onSpeak: (text: string) => void;
  isAiTyping?: boolean;
  // TTS-synchronized word reveal
  revealingMsgId?: number | null;
  revealedText?: string;
}

export default function ChatWindow({
  messages,
  streaming,
  streamContent,
  onSpeak,
  isAiTyping = false,
  revealingMsgId,
  revealedText,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 80;
    setShowScrollBtn(distanceFromBottom > 80);
  }, []);

  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamContent, isAiTyping]);

  if (messages.length === 0 && !streaming && !isAiTyping) {
    return null;
  }

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      <style>{`
        /* ── Message slide-in ── */
        @keyframes msgSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .chat-msg-animate { animation: msgSlideIn 0.22s ease; }

        /* ── Streaming cursor: blinking block at end of text ── */
        @keyframes streamCursor {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .stream-cursor::after {
          content: "▋";
          display: inline-block;
          margin-left: 2px;
          font-size: 0.85em;
          color: #1a73e8;
          animation: streamCursor 0.9s ease-in-out infinite;
          vertical-align: middle;
        }

        /* ── Pulsing blob: waiting for first token ── */
        @keyframes blobScale {
          0%, 100% { transform: scale(1);    opacity: 0.55; }
          50%       { transform: scale(1.22); opacity: 1;    }
        }
        @keyframes blobOrbit {
          0%   { transform: translate(0, 0) scale(0.7); opacity: 0.4; }
          25%  { transform: translate(5px, -5px) scale(1); opacity: 0.9; }
          50%  { transform: translate(10px, 0) scale(0.7); opacity: 0.4; }
          75%  { transform: translate(5px, 5px) scale(1); opacity: 0.9; }
          100% { transform: translate(0, 0) scale(0.7); opacity: 0.4; }
        }
        .ai-blob-wrap {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 2px;
        }
        .ai-blob-core {
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #1a73e8;
          animation: blobScale 1.2s ease-in-out infinite;
        }
        .ai-blob-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #1a73e8;
        }
        .ai-blob-dot:nth-child(2) { animation: blobScale 1.2s ease-in-out infinite 0.15s; opacity: 0.7; }
        .ai-blob-dot:nth-child(3) { animation: blobScale 1.2s ease-in-out infinite 0.30s; opacity: 0.5; }

        /* ── Streaming bubble: subtle left-border glow ── */
        @keyframes streamGlow {
          0%, 100% { border-left-color: #c5d8fb; }
          50%       { border-left-color: #1a73e8; }
        }
        .streaming-bubble {
          border-left: 3px solid #c5d8fb;
          animation: streamGlow 1.8s ease-in-out infinite;
          padding-left: 10px !important;
        }

        /* ── AI free-text: no bubble, clean prose ── */
        .ai-free-text {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
          font-size: 0.97rem;
          line-height: 1.7;
          color: var(--text-primary, #1a1a1a);
        }
        .ai-free-text p { margin: 0 0 0.6em 0; }
        .ai-free-text p:last-child { margin-bottom: 0; }
      `}</style>

      {messages.map((msg) => {
        if (msg.role === "system") {
          return (
            <div key={msg.id} className="message assistant chat-msg-animate">
              <div className="message-avatar error-avatar">!</div>
              <div className="message-content">
                <div className="message-bubble error-bubble">{msg.content}</div>
              </div>
            </div>
          );
        }

        if (msg.role === "quiz_result") {
          return (
            <div key={msg.id} className="chat-msg-animate" style={{
              display: "flex",
              justifyContent: "center",
              padding: "6px 12px",
            }}>
              <div style={{
                background: "var(--bg-secondary, #f1f5f9)",
                border: "1px solid var(--border-color, #e2e8f0)",
                borderRadius: 20,
                padding: "6px 16px",
                fontSize: 12,
                color: "var(--text-muted, #64748b)",
                fontStyle: "italic",
                textAlign: "center",
                maxWidth: "80%",
                lineHeight: 1.5,
              }}>
                {msg.content}
              </div>
            </div>
          );
        }

        if (msg.role === "assistant") {
          const displayContent =
            revealingMsgId != null && msg.id === revealingMsgId && revealedText != null
              ? revealedText
              : msg.content;

          return (
            <div key={msg.id} className="message assistant chat-msg-animate">
              <div className="message-avatar">AI</div>
              <div className="message-content ai-free-text">
                <ReactMarkdown>{displayContent}</ReactMarkdown>
                <div className="message-actions">
                  <button onClick={() => onSpeak(msg.content)} title="Read aloud">
                    <Volume2 size={14} />
                    <span>Listen</span>
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // user message
        return (
          <div key={msg.id} className={`message ${msg.role} chat-msg-animate`}>
            <div className="message-avatar">U</div>
            <div className="message-content">
              <div className="message-bubble">
                {msg.content}
              </div>
            </div>
          </div>
        );
      })}

      {/* Streaming: has content — borderless free text with left glow */}
      {streaming && streamContent && (
        <div className="message assistant chat-msg-animate">
          <div className="message-avatar">AI</div>
          <div className="message-content ai-free-text streaming-bubble">
            <span className="stream-cursor">
              <ReactMarkdown>{revealingMsgId != null && revealedText != null ? revealedText : streamContent}</ReactMarkdown>
            </span>
          </div>
        </div>
      )}

      {/* Streaming: waiting for first token — pulsing blob indicator */}
      {(streaming && !streamContent) || (isAiTyping && !streaming) ? (
        <div className="message assistant" style={{ animation: "msgSlideIn 0.22s ease" }}>
          <div className="message-avatar" style={{
            background: "linear-gradient(135deg, #1a73e8, #1557b0)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
          }}>AI</div>
          <div className="message-content">
            <div className="message-bubble" style={{
              background: "#f0f7ff",
              border: "1px solid #c5d8fb",
              minWidth: 64,
            }}>
              <div className="ai-blob-wrap">
                <div className="ai-blob-core" />
                <div className="ai-blob-dot" />
                <div className="ai-blob-dot" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} />

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "rgba(30,30,30,0.85)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "50%",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
          }}
        >
          <ChevronDown size={18} color="#fff" />
        </button>
      )}
    </div>
  );
}
