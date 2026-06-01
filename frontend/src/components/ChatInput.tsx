import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { Send, Mic, Square, PhoneOff, Plus, Paperclip, Globe, Search, X } from "lucide-react";

type VoiceStatus = "idle" | "connecting" | "listening" | "processing" | "speaking";

interface Props {
  onSend: (text: string, opts?: { imageData?: string; imageMime?: string; webSearch?: boolean; research?: boolean }) => void;
  streaming: boolean;
  onStop: () => void;
  voiceStatus: VoiceStatus;
  onVoiceStart: () => void;
  onVoiceEnd: () => void;
  disabled?: boolean;
  webSearchEnabled?: boolean;
  onWebSearchToggle?: () => void;
  researchEnabled?: boolean;
  onResearchToggle?: () => void;
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
  webSearchEnabled,
  onWebSearchToggle,
  researchEnabled,
  onResearchToggle,
}: Props) {
  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{ data: string; mime: string; name: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const inVoiceMode = voiceStatus !== "idle";
  const busy = disabled || streaming || voiceStatus === "connecting";

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header, b64] = result.split(",");
      const mime = header.split(":")[1].split(";")[0];
      setAttachedImage({ data: b64, mime, name: file.name });
    };
    reader.readAsDataURL(file);
    setDropdownOpen(false);
    // Reset file input so the same file can be re-selected
    e.target.value = "";
  };

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && !attachedImage) || busy) return;
    onSend(trimmed || "(shared an image)", {
      imageData: attachedImage?.data,
      imageMime: attachedImage?.mime,
      webSearch: webSearchEnabled,
      research: researchEnabled,
    });
    setInput("");
    setAttachedImage(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, attachedImage, busy, onSend, webSearchEnabled, researchEnabled]);

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
      <style>{`
        .plus-btn {
          background: transparent;
          border: 1px solid var(--border-color, #e2e8f0);
          border-radius: 8px;
          color: var(--text-muted, #64748b);
        }
        .plus-btn:hover {
          background: var(--bg-secondary, #f1f5f9);
          color: var(--text-primary, #1a1a1a);
        }
        .plus-dropdown {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 0;
          background: var(--bg-primary, #fff);
          border: 1px solid var(--border-color, #e2e8f0);
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          min-width: 200px;
          padding: 6px;
          z-index: 100;
        }
        .plus-dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          background: none;
          border: none;
          border-radius: 8px;
          font-size: 0.9rem;
          color: var(--text-primary, #1a1a1a);
          cursor: pointer;
          text-align: left;
          font-family: inherit;
        }
        .plus-dropdown-item:hover {
          background: var(--bg-secondary, #f1f5f9);
        }
        .plus-dropdown-item.active {
          color: #1a73e8;
        }
        .check-mark {
          margin-left: auto;
          font-weight: 700;
        }
      `}</style>

      {/* Attached image preview */}
      {attachedImage && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px",
          background: "var(--bg-secondary, #f1f5f9)",
          borderRadius: 8,
          marginBottom: 6,
          fontSize: 12,
        }}>
          <Paperclip size={12} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {attachedImage.name}
          </span>
          <button
            onClick={() => setAttachedImage(null)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="input-wrapper">
        {/* + attachment/tools button */}
        <div style={{ position: "relative" }} ref={dropdownRef}>
          <button
            className="input-btn plus-btn"
            onClick={() => setDropdownOpen((v) => !v)}
            type="button"
            title="Attachments and tools"
          >
            <Plus size={18} />
          </button>

          {dropdownOpen && (
            <div className="plus-dropdown">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.pdf,.doc,.docx"
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
              <button
                className="plus-dropdown-item"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={15} />
                Add files or photos
              </button>
              <button
                className={`plus-dropdown-item ${webSearchEnabled ? "active" : ""}`}
                onClick={() => { onWebSearchToggle?.(); setDropdownOpen(false); }}
              >
                <Globe size={15} />
                Web search
                {webSearchEnabled && <span className="check-mark">✓</span>}
              </button>
              <button
                className={`plus-dropdown-item ${researchEnabled ? "active" : ""}`}
                onClick={() => { onResearchToggle?.(); setDropdownOpen(false); }}
              >
                <Search size={15} />
                Research
                {researchEnabled && <span className="check-mark">✓</span>}
              </button>
            </div>
          )}
        </div>

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
            disabled={(!input.trim() && !attachedImage) || busy}
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
