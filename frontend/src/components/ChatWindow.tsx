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
  // When true, suppress streaming text and show only the blob (used with TTS)
  suppressStreamText?: boolean;
}

export default function ChatWindow({
  messages,
  streaming,
  streamContent,
  onSpeak,
  isAiTyping = false,
  revealingMsgId,
  revealedText,
  suppressStreamText = false,
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

        /* ── Claude-style thinking: pulsing star + skeleton lines ── */
        @keyframes starPulse {
          0%   { transform: rotate(0deg) scale(0.92); opacity: 0.7; }
          25%  { transform: rotate(90deg) scale(1.08); opacity: 1; }
          50%  { transform: rotate(180deg) scale(0.92); opacity: 0.7; }
          75%  { transform: rotate(270deg) scale(1.08); opacity: 1; }
          100% { transform: rotate(360deg) scale(0.92); opacity: 0.7; }
        }
        @keyframes skeletonShimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .ai-thinking-wrap {
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding: 4px 0;
        }
        .ai-thinking-star {
          animation: starPulse 1.8s ease-in-out infinite;
          color: #1a73e8;
          display: block;
        }
        .ai-skeleton-line {
          height: 9px;
          border-radius: 99px;
          background: linear-gradient(
            90deg,
            var(--border-color, #e2e8f0) 25%,
            #c5d8fb 50%,
            var(--border-color, #e2e8f0) 75%
          );
          background-size: 200% 100%;
          animation: skeletonShimmer 1.6s ease-in-out infinite;
        }

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
              <div className="message-avatar" style={{ background: "transparent", overflow: "hidden", padding: 1, flexShrink: 0 }}>
                <img src="/images/aitutor 4 schools-robo.png" style={{ width: "100%", height: "100%", objectFit: "contain" }} alt="AI" />
              </div>
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

      {/* Streaming: has content — borderless free text with left glow (hidden when suppressStreamText) */}
      {streaming && streamContent && !suppressStreamText && (
        <div className="message assistant chat-msg-animate">
          <div className="message-avatar" style={{ background: "transparent", overflow: "hidden", padding: 1, flexShrink: 0 }}>
            <img src="/images/aitutor 4 schools-robo.png" style={{ width: "100%", height: "100%", objectFit: "contain" }} alt="AI" />
          </div>
          <div className="message-content ai-free-text streaming-bubble">
            <span className="stream-cursor">
              <ReactMarkdown>{revealingMsgId != null && revealedText != null ? revealedText : streamContent}</ReactMarkdown>
            </span>
          </div>
        </div>
      )}

      {/* Thinking / stream-suppressed: Claude-style pulsing star + skeleton lines */}
      {(streaming && (!streamContent || suppressStreamText)) || (isAiTyping && !streaming) ? (
        <div className="message assistant" style={{ animation: "msgSlideIn 0.22s ease", alignItems: "flex-start" }}>
          <div className="message-avatar" style={{ background: "transparent", overflow: "hidden", padding: 1, flexShrink: 0 }}>
            <img src="/images/aitutor 4 schools-robo.png" style={{ width: "100%", height: "100%", objectFit: "contain" }} alt="AI" />
          </div>
          <div className="message-content" style={{ paddingTop: 2 }}>
            <div className="ai-thinking-wrap">
              {/* 4-pointed star SVG — rotates and pulses */}
              <svg className="ai-thinking-star" width="22" height="22" viewBox="0 0 24 24" fill="#1a73e8" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0 C12.5 5.5 13.5 9.5 14.5 11.5 C16.5 12.5 20.5 12 24 12 C20.5 12 16.5 11.5 14.5 12.5 C13.5 14.5 12.5 18.5 12 24 C11.5 18.5 10.5 14.5 9.5 12.5 C7.5 11.5 3.5 12 0 12 C3.5 12 7.5 12.5 9.5 11.5 C10.5 9.5 11.5 5.5 12 0 Z" />
              </svg>
              {/* Skeleton shimmer lines */}
              <div className="ai-skeleton-line" style={{ width: "72%" }} />
              <div className="ai-skeleton-line" style={{ width: "52%", animationDelay: "0.2s" }} />
              <div className="ai-skeleton-line" style={{ width: "36%", animationDelay: "0.4s" }} />
            </div>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} />

      {/* Scroll-to-bottom button — sticky inside the chat scroll container */}
      {showScrollBtn && (
        <div style={{
          position: "sticky",
          bottom: 16,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 20,
        }}>
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
            style={{
              pointerEvents: "all",
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
        </div>
      )}
    </div>
  );
}
