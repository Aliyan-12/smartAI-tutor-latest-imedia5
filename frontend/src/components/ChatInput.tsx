import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Mic, Square, PhoneOff } from "lucide-react";

type VoiceStatus = "idle" | "connecting" | "listening" | "processing" | "speaking";

interface Props {
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  voiceStatus: VoiceStatus;
  onVoiceStart: () => void;
  onVoiceEnd: () => void;
  disabled?: boolean;
}

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: "",
  connecting: "Connecting to voice...",
  listening: "Listening...",
  processing: "Thinking...",
  speaking: "Tutor is speaking...",
};

export default function ChatInput({
  onSend,
  streaming,
  onStop,
  voiceStatus,
  onVoiceStart,
  onVoiceEnd,
  disabled = false,
}: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const inVoiceMode = voiceStatus !== "idle";
  const busy = disabled || streaming || voiceStatus === "connecting";

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, busy, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  if (inVoiceMode) {
    return (
      <div className="input-area">
        <div className="voice-mode-bar">
          <div className="voice-status">
            <span className={`voice-dot ${voiceStatus}`} />
            <span className="voice-label">{STATUS_LABELS[voiceStatus]}</span>
          </div>
          <div className="voice-controls">
            <button
              className="input-btn end-call-btn"
              onClick={onVoiceEnd}
              title="End voice conversation"
              type="button"
            >
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="input-area">
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Session is paused — resume to continue chatting..." : "Ask me anything about your studies..."}
          rows={1}
          disabled={busy}
        />

        <button
          className="input-btn mic-btn"
          onClick={onVoiceStart}
          disabled={busy}
          title="Start voice conversation"
          type="button"
        >
          <Mic size={18} />
        </button>

        {streaming ? (
          <button className="input-btn stop-btn" onClick={onStop} title="Stop" type="button">
            <Square size={16} />
          </button>
        ) : (
          <button
            className="input-btn send-btn"
            onClick={handleSend}
            disabled={!input.trim() || busy}
            title="Send"
            type="button"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
