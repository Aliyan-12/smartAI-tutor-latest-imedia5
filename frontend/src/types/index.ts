export type UserRole = "superadmin" | "admin" | "teacher" | "student" | "parent";

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  credits: number;
  parent_id?: number | null;
  school_id?: number | null;
  is_verified?: boolean;
  onboarding_completed?: boolean;
  account_type?: "school" | "individual";
  auth_provider?: string;
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
  role: "user" | "assistant" | "system" | "quiz_result";
  content: string;
  timestamp: string;
  imageUrl?: string;   // attached image preview (data URL) for the live session
  fileName?: string;   // attached non-image file (PDF/DOC) name
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
  kb_type: string;
}

export interface DocumentListResponse {
  documents: KnowledgeDocument[];
  total: number;
}

export interface AssessmentQuestion {
  id: number;
  question_index: number;
  question_text: string;
  options: string[];
  correct_answer: number | null;
  student_answer: number | null;
  is_correct: boolean | null;
  explanation: string | null;
  topic_tag: string;
}

export interface Assessment {
  id: number;
  student_id: number;
  chat_session_id: string | null;
  subject: string;
  key_stage: string;
  topic: string;
  total_questions: number;
  correct_answers: number;
  score_percent: number;
  weak_topics: string[] | null;
  strong_topics: string[] | null;
  report_text: string | null;
  status: "in_progress" | "completed";
  created_at: string;
  questions: AssessmentQuestion[];
}

export interface Appointment {
  id: number;
  student_id: number;
  teacher_id: number;
  booked_by: number;
  subject: string;
  key_stage: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: "booked" | "confirmed" | "started" | "paused" | "terminated" | "completed" | "cancelled";
  payment_status: "pending" | "paid" | "refunded";
  payment_amount: number | null;
  passcode: string | null;
  session_started_at: string | null;
  paused_at: string | null;
  total_paused_seconds: number;
  meeting_link: string | null;
  notes: string | null;
  student_name?: string | null;
  teacher_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizOffer {
  topic: string;
  chat_session_id: string;
  assessment_id?: number;
  questions?: AssessmentQuestion[];
}

export interface StudentProgress {
  student_id: number;
  student_name: string;
  total_assessments: number;
  average_score: number | null;
  latest_score: number | null;
  weak_topics: string[];
  strong_topics: string[];
  assessments: Assessment[];
}

export interface StudentProfile {
  id: number;
  student_id: number;
  xp_total: number;
  xp_level: number;
  current_streak: number;
  longest_streak: number;
  key_stage?: string | null;
  last_active_date: string | null;
  interests: string[] | null;
  preferred_subjects: string[] | null;
}

export interface TopicMastery {
  id: number;
  student_id: number;
  subject: string;
  key_stage: string;
  topic: string;
  mastery_level: "not_started" | "learning" | "practicing" | "mastered";
  score_history: Array<{ score: number; date: string }> | null;
  attempts: number;
  last_practiced_at: string | null;
}

export interface LessonPlan {
  id: number;
  appointment_id: number | null;
  student_id: number;
  created_by: number;
  subject: string;
  key_stage: string;
  unit_name: string | null;
  subtopic: string | null;
  ability_level: string;
  goal: string;
  status: string;
  session_summary: string | null;
  created_at: string;
}

export interface DailyPlan {
  weak_spots: Array<{ topic: string; subject: string; mastery_level: string; last_score?: number }>;
  spaced_review: Array<{ topic: string; subject: string; days_since: number }>;
  confidence_boost: Array<{ topic: string; subject: string }>;
  upcoming_sessions: Array<{ id: number; title: string; subject: string; scheduled_at: string }>;
}

export interface DashboardData {
  profile: StudentProfile;
  mastery_overview: TopicMastery[];
  daily_plan: DailyPlan;
  continue_learning: {
    topic: string;
    subject: string;
    key_stage: string;
    mastery: number;
    last_mistake?: string;
  } | null;
  xp_to_next_level: number;
}

export interface LessonBlock {
  type: string;
  title: string;
  duration_minutes: number;
  description: string;
}

export interface GeneratedLessonPlan {
  lesson_title: string;
  preview_summary: string;
  blocks: LessonBlock[];
  personalisation_notes: string;
}

export interface SessionPhase {
  phase_title: string;
  phase_type: string;
  planned_minutes: number | null;
  what_was_covered: string;
  student_engagement: string;
  status: "completed" | "partial" | "not_started";
}

export interface SessionReport {
  appointment_id: number;
  summary: string;
  phases?: SessionPhase[];
  topics_covered: string[];
  student_messages_count?: number;
  ai_messages_count?: number;
  quiz_score_percent: number | null;
  weak_areas: string[];
  strong_areas: string[];
  understanding_level: string;
  next_session_recommendation: string;
  time_spent_minutes: number;
  xp_earned: number;
  encouragement?: string;
}

export interface HomeworkItem {
  id: number;
  teacher_id: number;
  title: string;
  subject: string;
  key_stage: string;
  topic: string;
  instructions: string | null;
  due_date: string | null;
  estimated_minutes: number;
  assignment_type: "homework" | "reading" | "prep" | "revision";
  status: string;
}

export interface MyAssignment {
  id: number;
  homework_id: number;
  status: "assigned" | "started" | "completed";
  started_at: string | null;
  completed_at: string | null;
  homework: HomeworkItem;
}

export interface LearningPreferences {
  learning_style: string[] | null;
  teaching_pace: string;
  teaching_preferences: Record<string, boolean> | null;
  interests: string[] | null;
  learning_goals: string | null;
  year_group: string | null;
  key_stage?: string | null;
  default_session_length: number;
  voice_responses: boolean;
  show_hints: boolean;
  auto_start_next_topic: boolean;
  notification_prefs: Record<string, boolean> | null;
}

export interface SlideData {
  slide_id: number;
  status: "generating" | "ready" | "failed";
  topic: string;
  presentation_id: string | null;
  viewer_url: string | null;
  pptx_url: string | null;
}
