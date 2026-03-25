import { useEffect } from "react";
import { MessageSquarePlus, Trash2, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import type { ChatListItem } from "../types";

interface Props {
  chatList: ChatListItem[];
  activeChatId: number | null;
  onNewChat: () => void;
  onSelectChat: (id: number) => void;
  onDeleteChat: (id: number) => void;
  onLoadChats: () => void;
}

export default function Sidebar({
  chatList,
  activeChatId,
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

      <button className="new-chat-btn" onClick={onNewChat}>
        <MessageSquarePlus size={16} />
        New Chat
      </button>

      <div className="chat-list">
        {chatList.map((chat) => (
          <div
            key={chat.id}
            className={`chat-list-item ${chat.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelectChat(chat.id)}
          >
            <span className="title">{chat.title}</span>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteChat(chat.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <span className="user-info">{user?.name}</span>
        <button className="logout-btn" onClick={logout} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
