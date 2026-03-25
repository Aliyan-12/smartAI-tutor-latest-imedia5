import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Mic, MicOff, Square } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  recording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => Promise<string | null>;
}

export default function ChatInput({
  onSend,
  streaming,
  onStop,
  recording,
  onStartRecording,
  onStopRecording,
}: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, streaming, onSend]);

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

  const handleMic = async () => {
    if (recording) {
      const text = await onStopRecording();
      if (text) {
        setInput((prev) => (prev ? prev + " " + text : text));
      }
    } else {
      onStartRecording();
    }
  };

  return (
    <div className="input-area">
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything about your studies..."
          rows={1}
          disabled={streaming}
        />

        <button
          className={`input-btn mic-btn ${recording ? "active" : ""}`}
          onClick={handleMic}
          title={recording ? "Stop recording" : "Start recording"}
          type="button"
        >
          {recording ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        {streaming ? (
          <button
            className="input-btn stop-btn"
            onClick={onStop}
            title="Stop generating"
            type="button"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className="input-btn send-btn"
            onClick={handleSend}
            disabled={!input.trim()}
            title="Send message"
            type="button"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
