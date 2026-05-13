import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Volume2 } from "lucide-react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  streamContent: string;
  onSpeak: (text: string) => void;
  isAiTyping?: boolean;
}

export default function ChatWindow({
  messages,
  streaming,
  streamContent,
  onSpeak,
  isAiTyping = false,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 80;
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
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes msgSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .chat-msg-animate {
          animation: msgSlideIn 0.25s ease;
        }
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

        return (
          <div key={msg.id} className={`message ${msg.role} chat-msg-animate`}>
            <div className="message-avatar">
              {msg.role === "user" ? "U" : "AI"}
            </div>
            <div className="message-content">
              <div className="message-bubble">
                {msg.role === "assistant" ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === "assistant" && (
                <div className="message-actions">
                  <button onClick={() => onSpeak(msg.content)} title="Read aloud">
                    <Volume2 size={14} />
                    <span>Listen</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {streaming && streamContent && (
        <div className="message assistant chat-msg-animate">
          <div className="message-avatar">AI</div>
          <div className="message-content">
            <div className="message-bubble">
              <ReactMarkdown>{streamContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {streaming && !streamContent && (
        <div className="message assistant">
          <div className="message-avatar">AI</div>
          <div className="message-content">
            <div className="message-bubble">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAiTyping && !streaming && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "4px 0" }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--accent-blue, #6366f1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            flexShrink: 0,
          }}>AI</div>
          <div style={{
            background: "var(--bg-secondary, #f8fafc)",
            border: "1px solid var(--border-color, #e2e8f0)",
            borderRadius: 12,
            padding: "10px 14px",
            display: "flex",
            gap: 4,
            alignItems: "center",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", display: "inline-block", animation: "typingDot 1.4s ease-in-out infinite" }} />
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", display: "inline-block", animation: "typingDot 1.4s ease-in-out infinite 0.2s" }} />
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", display: "inline-block", animation: "typingDot 1.4s ease-in-out infinite 0.4s" }} />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
