import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import type { ChatMessage } from "../types";

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
    loadChats,
    loadCredits,
    loadChat,
    startNewChat,
    sendMessage,
    deleteChat,
    stopStreaming,
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

  useEffect(() => {
    loadCredits();
    loadChats();
  }, [loadCredits, loadChats]);

  useEffect(() => {
    if (sessionId && sessionId !== activeSessionId) {
      loadChat(sessionId);
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const showWelcome = allMessages.length === 0 && !isStreaming && !isVoiceActive;

  return (
    <div className="app-layout">
      <Sidebar
        chatList={chatList}
        activeSessionId={activeSessionId}
        credits={credits}
        onNewChat={startNewChat}
        onSelectChat={loadChat}
        onDeleteChat={deleteChat}
        onLoadChats={loadChats}
      />

      <div className="main-content">
        <div className="chat-container">
          {showWelcome ? (
            <WelcomeScreen onPromptClick={sendMessage} />
          ) : (
            <ChatWindow
              messages={allMessages}
              streaming={isStreaming}
              streamContent={currentStreamContent}
              onSpeak={speakText}
            />
          )}
        </div>

        {voiceError && (
          <div className="voice-error-bar">
            <span>{voiceError}</span>
            <button onClick={clearVoiceError} className="voice-error-close">
              <X size={14} />
            </button>
          </div>
        )}

        <ChatInput
          onSend={sendMessage}
          streaming={streaming}
          onStop={stopStreaming}
          voiceStatus={voiceStatus}
          onVoiceStart={handleVoiceStart}
          onVoiceEnd={handleVoiceEnd}
        />
      </div>
    </div>
  );
}
