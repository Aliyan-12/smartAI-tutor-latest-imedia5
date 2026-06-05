import { useState, useCallback } from "react";
import { chatApi } from "../services/api";
import type { ChatListItem } from "../types";

/**
 * useChat — lightweight chat-list + credits state for the dashboard sidebar.
 *
 * The old SSE message-streaming pipeline (sendMessage / sendQuizFeedback) was
 * removed: chat now runs entirely over the WebSocket channel (useSessionChannel),
 * so this hook only exposes the list/credits helpers the dashboard needs.
 */
export function useChat() {
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [credits, setCredits] = useState<number | null>(null);

  const loadChats = useCallback(async () => {
    try {
      setChatList((await chatApi.listChats()) as ChatListItem[]);
    } catch (err) {
      console.error("Failed to load chats:", err);
    }
  }, []);

  const loadCredits = useCallback(async () => {
    try {
      const data = await chatApi.getCredits();
      setCredits(data.credits);
    } catch {
      // ignore
    }
  }, []);

  return { chatList, credits, loadChats, loadCredits };
}
