import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Volume2, ChevronDown } from "lucide-react";
import type { ChatMessage } from "../types";

const AI_LOGO = "/images/aitutor 4 schools-robo.png";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  streamContent: string;
  onSpeak: (text: string) => void;
  isWaiting?: boolean;
  revealContent?: string | null;
  revealedText?: string;
  lastKnownAiId?: number | null;
  fillerText?: string | null;
  // Unified session pipeline (useSessionChannel): the single in-flight assistant
  // turn revealing in lockstep with its audio, plus its status.
  liveText?: string | null;
  liveStatus?: "idle" | "connecting" | "waiting" | "speaking";
}

export default function ChatWindow({
  messages,
  streaming,
  streamContent,
  onSpeak,
  isWaiting = false,
  revealContent,
  revealedText,
  lastKnownAiId,
  fillerText,
  liveText,
  liveStatus,
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
  }, [messages, streamContent, isWaiting, revealedText, revealContent, liveText, liveStatus]);

  const liveActive = !!liveText || (liveStatus != null && liveStatus !== "idle");
  if (messages.length === 0 && !streaming && !isWaiting && !liveActive) {
    return null;
  }

  const AiAvatar = () => (
    <div className="message-avatar" style={{ background: "transparent", overflow: "hidden", padding: 1, flexShrink: 0 }}>
      <img src={AI_LOGO} style={{ width: "100%", height: "100%", objectFit: "contain" }} alt="AI" />
    </div>
  );

  const ThinkingBlob = () => (
    <div className="message assistant" style={{ animation: "msgSlideIn 0.22s ease", alignItems: "center" }}>
      <AiAvatar />
      <div className="message-content" style={{ paddingTop: 0 }}>
        <span className="tts-reveal-ball" style={{ width: 11, height: 11 }} />
      </div>
    </div>
  );

  // Distinctive "spoken aside" bubble shown while a pre-recorded filler phrase
  // plays — visually nothing like the AI's real answer (gradient pill + equaliser).
  const FillerBubble = ({ text }: { text: string }) => (
    <div className="message assistant" style={{ animation: "msgSlideIn 0.22s ease", alignItems: "center" }}>
      <AiAvatar />
      <div className="message-content" style={{ paddingTop: 0 }}>
        <div className="filler-bubble">
          <span className="filler-eq"><i /><i /><i /></span>
          <span className="filler-text">{text}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      <style>{`
        @keyframes msgSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .chat-msg-animate { animation: msgSlideIn 0.22s ease; }

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

        @keyframes streamGlow {
          0%, 100% { border-left-color: #c5d8fb; }
          50%       { border-left-color: #1a73e8; }
        }
        .streaming-bubble {
          border-left: 3px solid #c5d8fb;
          animation: streamGlow 1.8s ease-in-out infinite;
          padding-left: 10px !important;
        }

        @keyframes ballPulse {
          0%, 100% { transform: scale(0.8); opacity: 0.6; }
          50%       { transform: scale(1.2); opacity: 1;   }
        }
        .tts-reveal-ball {
          display: inline-block;
          width: 9px; height: 9px;
          border-radius: 50%;
          background: #1a73e8;
          margin-left: 5px;
          vertical-align: middle;
          animation: ballPulse 0.75s ease-in-out infinite;
        }

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

        @keyframes fillerEq {
          0%, 100% { transform: scaleY(0.35); }
          50%       { transform: scaleY(1); }
        }
        @keyframes fillerGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
          50%       { box-shadow: 0 0 0 4px rgba(99,102,241,0.10); }
        }
        .filler-bubble {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 8px 14px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(99,102,241,0.13), rgba(26,115,232,0.13));
          border: 1px solid rgba(99,102,241,0.28);
          animation: fillerGlow 1.8s ease-in-out infinite;
        }
        .filler-eq {
          display: inline-flex;
          align-items: flex-end;
          gap: 2px;
          height: 14px;
        }
        .filler-eq i {
          display: block;
          width: 3px;
          height: 100%;
          border-radius: 2px;
          background: linear-gradient(#6366f1, #1a73e8);
          transform-origin: bottom;
          animation: fillerEq 0.85s ease-in-out infinite;
        }
        .filler-eq i:nth-child(2) { animation-delay: 0.16s; }
        .filler-eq i:nth-child(3) { animation-delay: 0.32s; }
        .filler-text {
          font-size: 0.9rem;
          font-style: italic;
          font-weight: 500;
          color: #4338ca;
          letter-spacing: 0.01em;
        }
      `}</style>

      {/* ── All past messages ── */}
      {(() => {
        const hiddenAiId = (isWaiting || revealContent != null)
          ? [...messages].reverse().find((m) => m.role === "assistant" && (lastKnownAiId == null || m.id > lastKnownAiId))?.id ?? null
          : null;

        return messages.map((msg) => {
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
            <div key={msg.id} className="chat-msg-animate" style={{ display: "flex", justifyContent: "center", padding: "6px 12px" }}>
              <div style={{
                background: "var(--bg-secondary, #f1f5f9)",
                border: "1px solid var(--border-color, #e2e8f0)",
                borderRadius: 20, padding: "6px 16px",
                fontSize: 12, color: "var(--text-muted, #64748b)",
                fontStyle: "italic", textAlign: "center",
                maxWidth: "80%", lineHeight: 1.5,
              }}>
                {msg.content}
              </div>
            </div>
          );
        }

        if (msg.role === "assistant") {
          if (hiddenAiId !== null && msg.id === hiddenAiId) return null;

          return (
            <div key={msg.id} className="message assistant chat-msg-animate">
              <AiAvatar />
              <div className="message-content ai-free-text">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
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

        return (
          <div key={msg.id} className={`message ${msg.role} chat-msg-animate`}>
            <div className="message-avatar">U</div>
            <div className="message-content">
              <div className="message-bubble">
                {msg.imageUrl && (
                  <img
                    src={msg.imageUrl}
                    alt="attachment"
                    style={{ display: "block", maxWidth: 220, maxHeight: 220, borderRadius: 10, marginBottom: msg.content ? 8 : 0 }}
                  />
                )}
                {msg.fileName && (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
                    background: "rgba(255,255,255,0.18)", borderRadius: 8, fontSize: 12,
                    marginBottom: msg.content ? 8 : 0,
                  }}>
                    📎 {msg.fileName}
                  </div>
                )}
                {msg.content}
              </div>
            </div>
          </div>
        );
      });
      })()}

      {/* ── Live TTS reveal row ── */}
      {revealContent != null && (
        <div className="message assistant chat-msg-animate">
          <AiAvatar />
          <div className="message-content ai-free-text">
            <ReactMarkdown>{revealedText || revealContent[0] || ""}</ReactMarkdown>
            {(revealedText?.length ?? 0) < revealContent.length
              ? <span className="tts-reveal-ball" />
              : (
                <div className="message-actions">
                  <button onClick={() => onSpeak(revealContent)} title="Read aloud">
                    <Volume2 size={14} />
                    <span>Listen</span>
                  </button>
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ── Streaming text (TTS-off mode: show text as it arrives) ── */}
      {!isWaiting && streaming && streamContent && (
        <div className="message assistant chat-msg-animate">
          <AiAvatar />
          <div className="message-content ai-free-text streaming-bubble">
            <span className="stream-cursor">
              <ReactMarkdown>{streamContent}</ReactMarkdown>
            </span>
          </div>
        </div>
      )}

      {/* ── Blob / filler: waiting for response OR TTS-off waiting for first token ── */}
      {(isWaiting || (!isWaiting && streaming && !streamContent)) && (
        fillerText && isWaiting ? <FillerBubble text={fillerText} /> : <ThinkingBlob />
      )}

      {/* ── Unified session live turn (useSessionChannel): one in-flight reply ── */}
      {liveText ? (
        <div className="message assistant chat-msg-animate">
          <AiAvatar />
          <div className="message-content ai-free-text">
            <ReactMarkdown>{liveText}</ReactMarkdown>
            {liveStatus === "speaking" ? (
              <span className="tts-reveal-ball" />
            ) : (
              <div className="message-actions">
                <button onClick={() => onSpeak(liveText)} title="Read aloud">
                  <Volume2 size={14} />
                  <span>Listen</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : liveStatus === "waiting" ? (
        fillerText ? <FillerBubble text={fillerText} /> : <ThinkingBlob />
      ) : null}

      <div ref={bottomRef} />

      {showScrollBtn && (
        <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 20 }}>
          <button
            onClick={() => { userScrolledUpRef.current = false; bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
            style={{
              pointerEvents: "all",
              background: "rgba(30,30,30,0.85)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "50%",
              width: 36, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
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
