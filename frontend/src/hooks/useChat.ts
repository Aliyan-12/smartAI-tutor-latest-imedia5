import { useState, useCallback, useRef } from "react";
import { chatApi } from "../services/api";
import type { ChatMessage, ChatListItem, Chat } from "../types";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const cancelRef = useRef<(() => void) | null>(null);

  const loadChats = useCallback(async () => {
    const list = (await chatApi.listChats()) as ChatListItem[];
    setChatList(list);
  }, []);

  const loadChat = useCallback(async (chatId: number) => {
    const chat = (await chatApi.getChat(chatId)) as Chat;
    setMessages(chat.messages);
    setActiveChatId(chatId);
  }, []);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveChatId(null);
    setStreamContent("");
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const userMsg: ChatMessage = {
        id: Date.now(),
        chat_id: activeChatId || 0,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      setStreamContent("");

      let accumulated = "";

      const cancel = chatApi.streamMessage(
        text,
        activeChatId,
        (event) => {
          if (event.type === "start" && event.chat_id) {
            setActiveChatId(event.chat_id);
          } else if (event.type === "token" && event.content) {
            accumulated += event.content;
            setStreamContent(accumulated);
          } else if (event.type === "title" && event.content) {
            loadChats();
          }
        },
        () => {
          const assistantMsg: ChatMessage = {
            id: Date.now() + 1,
            chat_id: activeChatId || 0,
            role: "assistant",
            content: accumulated,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setStreamContent("");
          setStreaming(false);
          loadChats();
        },
        (err) => {
          console.error("Stream error:", err);
          setStreaming(false);
          setStreamContent("");
        }
      );

      cancelRef.current = cancel;
    },
    [activeChatId, loadChats]
  );

  const deleteChat = useCallback(
    async (chatId: number) => {
      await chatApi.deleteChat(chatId);
      if (activeChatId === chatId) {
        startNewChat();
      }
      await loadChats();
    },
    [activeChatId, startNewChat, loadChats]
  );

  const stopStreaming = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setStreaming(false);
    if (streamContent) {
      const assistantMsg: ChatMessage = {
        id: Date.now(),
        chat_id: activeChatId || 0,
        role: "assistant",
        content: streamContent,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamContent("");
    }
  }, [streamContent, activeChatId]);

  return {
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
  };
}
