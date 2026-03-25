export interface User {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface ChatMessage {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface Chat {
  id: number;
  title: string;
  created_at: string;
  messages: ChatMessage[];
}

export interface ChatListItem {
  id: number;
  title: string;
  created_at: string;
  last_message?: string;
}

export interface StreamEvent {
  type: "start" | "token" | "end" | "title";
  content?: string;
  chat_id?: number;
}
