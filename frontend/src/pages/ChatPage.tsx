import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";

export default function ChatPage() {
  const {
    messages,
    chatList,
    activeChatId,
    streaming,
    streamContent,
    loadChats,
    loadChat,
    startNewChat,
    sendMessage,
    deleteChat,
    stopStreaming,
  } = useChat();

  const { recording, startRecording, stopRecording, speakText } = useVoice();

  const showWelcome = messages.length === 0 && !streaming;

  return (
    <div className="app-layout">
      <Sidebar
        chatList={chatList}
        activeChatId={activeChatId}
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
