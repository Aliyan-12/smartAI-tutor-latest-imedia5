import { useEffect } from "react";
import { MessageSquarePlus, Trash2, LogOut, Coins } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import type { ChatListItem } from "../types";

interface Props {
  chatList: ChatListItem[];
  activeSessionId: string | null;
  credits: number | null;
  onNewChat: () => void;
  onSelectChat: (sessionId: string) => void;
  onDeleteChat: (sessionId: string) => void;
  onLoadChats: () => void;
}

export default function Sidebar({
  chatList,
  activeSessionId,
  credits,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onLoadChats,
}: Props) {
  const { user, logout } = useAuth();

  useEffect(() => {
    onLoadChats();
  }, [onLoadChats]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo">AI</div>
        <h2>SmartAI Tutor</h2>
      </div>

      {credits !== null && (
        <div className="credits-display">
          <Coins size={14} />
          <span>{credits.toFixed(0)} credits</span>
        </div>
      )}

      <button className="new-chat-btn" onClick={onNewChat}>
        <MessageSquarePlus size={16} />
        New Chat
      </button>

      <div className="chat-list">
        {chatList.map((chat) => (
          <div
            key={chat.session_id}
            className={`chat-list-item ${chat.session_id === activeSessionId ? "active" : ""}`}
            onClick={() => onSelectChat(chat.session_id)}
          >
            <span className="title">{chat.title}</span>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteChat(chat.session_id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="user-info">
          <span>{user?.name}</span>
          <span className="role-badge">{user?.role}</span>
        </div>
        <button className="logout-btn" onClick={logout} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
