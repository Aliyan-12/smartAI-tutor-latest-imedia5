import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { chatApi } from "../services/api";
import type { ChatMessage, ChatListItem, Chat, QuizOffer } from "../types";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [quizOffer, setQuizOffer] = useState<QuizOffer | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();

  const loadChats = useCallback(async () => {
    try {
      const list = (await chatApi.listChats()) as ChatListItem[];
      setChatList(list);
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

  const loadChat = useCallback(async (sessionId: string) => {
    try {
      const chat = (await chatApi.getChat(sessionId)) as Chat;
      setMessages(chat.messages);
      setActiveSessionId(sessionId);
      navigate(`/chat/${sessionId}`, { replace: true });
    } catch (err) {
      console.error("Chat not found:", sessionId);
      setMessages([]);
      setActiveSessionId(null);
      navigate("/chat", { replace: true });
    }
  }, [navigate]);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveSessionId(null);
    setStreamContent("");
    setQuizOffer(null);
    navigate("/chat", { replace: true });
  }, [navigate]);

  const resetChat = useCallback(() => {
    setMessages([]);
    setActiveSessionId(null);
    setStreamContent("");
    setQuizOffer(null);
  }, []);

  const initSessionChat = useCallback(async (appointmentId: number) => {
    try {
      const data = await chatApi.getOrCreateSessionChat(appointmentId);
      setActiveSessionId(data.session_id);
      setStreamContent("");
      setQuizOffer(null);
      const loaded: ChatMessage[] = data.messages.map((m) => ({
        id: m.id,
        chat_id: m.chat_id,
        role: m.role as ChatMessage["role"],
        content: m.content,
        timestamp: m.timestamp,
      }));
      setMessages(loaded);
    } catch (err) {
      console.error("Failed to init session chat:", err);
    }
  }, []);

  const sendMessage = useCallback(
    (text: string, opts?: {
      suppressNavigation?: boolean;
      onStreamStart?: () => void;
      onToken?: (chunk: string) => void;
      onStreamComplete?: (text: string) => void;
    }) => {
      const userMsg: ChatMessage = {
        id: Date.now(),
        chat_id: 0,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      setStreamContent("");

      let accumulated = "";
      let hasError = false;

      const cancel = chatApi.streamMessage(
        text,
        activeSessionId,
        (event) => {
          if (event.type === "start" && event.session_id) {
            setActiveSessionId(event.session_id);
            if (!opts?.suppressNavigation) {
              navigate(`/chat/${event.session_id}`, { replace: true });
            }
            opts?.onStreamStart?.();
          } else if (event.type === "token" && event.content) {
            if (event.content.startsWith("[Error:")) {
              hasError = true;
              const errorText = event.content;
              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now() + 1,
                  chat_id: 0,
                  role: "system" as const,
                  content: errorText,
                  timestamp: new Date().toISOString(),
                },
              ]);
              setStreamContent("");
              setStreaming(false);
              return;
            }
            accumulated += event.content;
            setStreamContent(accumulated);
            opts?.onToken?.(event.content);
          } else if (event.type === "title") {
            loadChats();
          } else if (event.type === "credits" && event.content) {
            setCredits(parseFloat(event.content));
          } else if (event.type === "quiz_offer" && event.content) {
            setQuizOffer({
              topic: event.content,
              chat_session_id: activeSessionId || "",
            });
          }
        },
        () => {
          if (hasError || !accumulated) {
            setStreamContent("");
            setStreaming(false);
            return;
          }
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 1,
              chat_id: 0,
              role: "assistant",
              content: accumulated,
              timestamp: new Date().toISOString(),
            },
          ]);
          setStreamContent("");
          setStreaming(false);
          loadChats();
          opts?.onStreamComplete?.(accumulated);
        },
        (err) => {
          console.error("Stream error:", err);
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 1,
              chat_id: 0,
              role: "system",
              content: err.message || "Something went wrong. Please try again.",
              timestamp: new Date().toISOString(),
            },
          ]);
          setStreaming(false);
          setStreamContent("");
        }
      );

      cancelRef.current = cancel;
    },
    [activeSessionId, loadChats, navigate]
  );

  const deleteChat = useCallback(
    async (sessionId: string) => {
      await chatApi.deleteChat(sessionId);
      if (activeSessionId === sessionId) {
        startNewChat();
      }
      await loadChats();
    },
    [activeSessionId, startNewChat, loadChats]
  );

  const stopStreaming = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setStreaming(false);
    if (streamContent) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          chat_id: 0,
          role: "assistant",
          content: streamContent,
          timestamp: new Date().toISOString(),
        },
      ]);
      setStreamContent("");
    }
  }, [streamContent]);

  const clearQuizOffer = useCallback(() => setQuizOffer(null), []);

  return {
    messages,
    chatList,
    activeSessionId,
    streaming,
    streamContent,
    credits,
    quizOffer,
    loadChats,
    loadCredits,
    loadChat,
    startNewChat,
    resetChat,
    initSessionChat,
    sendMessage,
    deleteChat,
    stopStreaming,
    clearQuizOffer,
  };
}
