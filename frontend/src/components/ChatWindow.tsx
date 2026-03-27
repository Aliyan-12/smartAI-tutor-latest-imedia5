import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Volume2 } from "lucide-react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  streamContent: string;
  onSpeak: (text: string) => void;
}

export default function ChatWindow({
  messages,
  streaming,
  streamContent,
  onSpeak,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  if (messages.length === 0 && !streaming) {
    return null;
  }

  return (
    <>
      {messages.map((msg) => {
        if (msg.role === "system") {
          return (
            <div key={msg.id} className="message assistant">
              <div className="message-avatar error-avatar">!</div>
              <div className="message-content">
                <div className="message-bubble error-bubble">{msg.content}</div>
              </div>
            </div>
          );
        }

        return (
          <div key={msg.id} className={`message ${msg.role}`}>
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
        <div className="message assistant">
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

      <div ref={bottomRef} />
    </>
  );
}
