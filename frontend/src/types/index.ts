export type UserRole = "admin" | "teacher" | "student";

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  credits: number;
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
  session_id: string;
  title: string;
  created_at: string;
  messages: ChatMessage[];
}

export interface ChatListItem {
  id: number;
  session_id: string;
  title: string;
  created_at: string;
  last_message?: string;
}

export interface StreamEvent {
  type: "start" | "token" | "end" | "title" | "credits" | "error";
  content?: string;
  session_id?: string;
}

export interface SubscriptionPlan {
  name: string;
  credits: number;
  price: number;
  description: string;
}

export interface CreditTransaction {
  id: number;
  user_id: number;
  amount: number;
  balance_after: number;
  tx_type: string;
  description: string;
  created_at: string;
}

export interface DashboardStats {
  total_users?: number;
  total_students: number;
  total_teachers?: number;
  active_students?: number;
  total_chats: number;
  total_messages: number;
}

export interface KnowledgeDocument {
  id: number;
  title: string;
  key_stage: string;
  subject: string;
  exam_board: string;
  tier: string;
  unit_name?: string;
  source_type: "upload" | "scrape" | "onedrive" | "gdocs";
  source_url?: string;
  file_type?: string;
  status: "pending" | "processing" | "ready" | "failed";
  error_message?: string;
  chunk_count: number;
  uploaded_by: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  documents: KnowledgeDocument[];
  total: number;
}
