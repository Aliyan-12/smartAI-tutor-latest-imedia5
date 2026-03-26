import { useEffect } from "react";
import { useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();

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

  const { recording, startRecording, stopRecording, speakText } = useVoice();

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  useEffect(() => {
    if (sessionId && sessionId !== activeSessionId) {
      loadChat(sessionId);
    } else if (!sessionId && activeSessionId) {
      // URL is /chat but we have an active session — clear it
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const showWelcome = messages.length === 0 && !streaming;

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
              messages={messages}
              streaming={streaming}
              streamContent={streamContent}
              onSpeak={speakText}
            />
          )}
        </div>

        <ChatInput
          onSend={sendMessage}
          streaming={streaming}
          onStop={stopStreaming}
          recording={recording}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
        />
      </div>
    </div>
  );
}
