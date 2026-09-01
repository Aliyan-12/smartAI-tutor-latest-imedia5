const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("token");
}

function authHeaders(): HeadersInit {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    // FastAPI validation errors return detail as an array [{loc, msg, type}]
    const detail = body.detail;
    let message: string;
    if (Array.isArray(detail)) {
      message = detail.map((e: { msg?: string }) => e.msg || "Validation error").join("; ");
    } else {
      message = detail || `Request failed with status ${response.status}`;
    }
    throw new Error(message);
  }
  return response.json();
}

export interface RegisterPayload {
  account_type: "school" | "individual";
  role?: "student" | "parent";
  name: string;
  email: string;
  password: string;
  school_name?: string;
  country?: string;
}

export const authApi = {
  // Returns { status: "verification_sent", email, dev_verify_token? } — NOT a token.
  async register(payload: RegisterPayload) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return handleResponse(res);
  },

  async verifyEmail(token: string) {
    const res = await fetch(`${API_BASE}/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return handleResponse(res);
  },

  async resendVerification(email: string) {
    const res = await fetch(`${API_BASE}/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  },

  async forgotPassword(email: string) {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  },

  async resetPassword(token: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    return handleResponse(res);
  },

  googleLoginUrl() {
    return `${API_BASE}/auth/oauth/google/login`;
  },

  async getMe() {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  onboarding: {
    async profile(body: Record<string, unknown>) {
      const res = await fetch(`${API_BASE}/auth/onboarding/profile`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      return handleResponse(res);
    },
    async preferences(body: Record<string, unknown>) {
      const res = await fetch(`${API_BASE}/auth/onboarding/preferences`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      return handleResponse(res);
    },
    async complete() {
      const res = await fetch(`${API_BASE}/auth/onboarding/complete`, {
        method: "POST",
        headers: authHeaders(),
      });
      return handleResponse(res);
    },
  },
};

export interface SchoolUser {
  id: number; name: string; email: string; role: string;
  is_active: boolean; is_verified: boolean; onboarding_completed: boolean; created_at: string;
}
export interface SchoolStats {
  school: { id: number; name: string; slug: string; country: string | null; account_type: string; is_default: boolean };
  teachers: number; students: number; parents: number; total: number;
}

export const schoolApi = {
  async getMySchool(): Promise<SchoolStats> {
    return handleResponse(await fetch(`${API_BASE}/school/me`, { headers: authHeaders() }));
  },
  async updateSchool(body: { name?: string; country?: string }) {
    return handleResponse(await fetch(`${API_BASE}/school`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify(body),
    }));
  },
  async listUsers(role?: string): Promise<{ users: SchoolUser[]; total: number }> {
    const q = role ? `?role=${encodeURIComponent(role)}` : "";
    return handleResponse(await fetch(`${API_BASE}/school/users${q}`, { headers: authHeaders() }));
  },
  async addUser(body: { name: string; email: string; password: string; role: string }) {
    return handleResponse(await fetch(`${API_BASE}/school/users`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify(body),
    }));
  },
  async setUserActive(userId: number, isActive: boolean) {
    return handleResponse(await fetch(`${API_BASE}/school/users/${userId}/active?is_active=${isActive}`, {
      method: "PATCH", headers: authHeaders(),
    }));
  },
};

export const chatApi = {
  async listChats() {
    const res = await fetch(`${API_BASE}/chat/list`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getChat(sessionId: string) {
    const res = await fetch(`${API_BASE}/chat/${sessionId}`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async deleteChat(sessionId: string) {
    const res = await fetch(`${API_BASE}/chat/${sessionId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error("Failed to delete chat");
    }
  },

  async getCredits(): Promise<{ credits: number; cost_per_message: number }> {
    const res = await fetch(`${API_BASE}/chat/credits`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getOrCreateSessionChat(appointmentId: number) {
    const res = await fetch(`${API_BASE}/chat/for-appointment/${appointmentId}`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse<{ session_id: string; messages: Array<{ id: number; chat_id: number; role: string; content: string; timestamp: string }> }>(res);
  },
};

// Build the unified session WebSocket URL (auth via query token, like the voice WS).
export function sessionWsUrl(appointmentId: number | null, sessionId: string | null): string {
  const token = getToken() ?? "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  let url = `${proto}//${window.location.host}/api/sessions/ws?token=${encodeURIComponent(token)}`;
  if (appointmentId) url += `&appointment_id=${appointmentId}`;
  if (sessionId) url += `&session_id=${encodeURIComponent(sessionId)}`;
  return url;
}

// Build the simple-chat WebSocket URL (text + voice on one socket), auth via query token.
export function chatWsUrl(sessionId: string | null): string {
  const token = getToken() ?? "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  let url = `${proto}//${window.location.host}/api/chat/ws?token=${encodeURIComponent(token)}`;
  if (sessionId) url += `&session_id=${encodeURIComponent(sessionId)}`;
  return url;
}

export const adminApi = {
  async getDashboard() {
    const res = await fetch(`${API_BASE}/admin/dashboard`, { headers: authHeaders() });
    return handleResponse(res);
  },

  // ── Administrator-only: school-admin approvals + all schools ──
  async getPendingApprovals() {
    const res = await fetch(`${API_BASE}/admin/pending-approvals`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async approveUser(userId: number) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/approve`, { method: "POST", headers: authHeaders() });
    return handleResponse(res);
  },
  async rejectUser(userId: number) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/reject`, { method: "POST", headers: authHeaders() });
    return handleResponse(res);
  },
  async getAllSchools() {
    const res = await fetch(`${API_BASE}/admin/schools`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getUsers(params?: { role?: string; is_active?: boolean }) {
    const query = new URLSearchParams();
    if (params?.role) query.set("role", params.role);
    if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
    const res = await fetch(`${API_BASE}/admin/users?${query}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async createUser(data: { name: string; email: string; password: string; role: string; credits: number }) {
    const res = await fetch(`${API_BASE}/admin/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async updateUser(userId: number, data: Record<string, unknown>) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async deleteUser(userId: number) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Failed to delete user");
    }
  },

  async adjustCredits(userId: number, amount: number, description: string) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/credits`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ amount, description }),
    });
    return handleResponse(res);
  },

  async getUserChats(userId: number) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/chats`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getAllChats() {
    const res = await fetch(`${API_BASE}/admin/chats`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async viewChat(sessionId: string) {
    const res = await fetch(`${API_BASE}/admin/chats/${sessionId}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async generateInviteCode(studentId: number) {
    const res = await fetch(`${API_BASE}/admin/users/${studentId}/generate-invite`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async linkStudentToParent(parentId: number, studentId: number) {
    const res = await fetch(`${API_BASE}/admin/users/${parentId}/link-student?student_id=${studentId}`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
};

export const teacherApi = {
  async getDashboard() {
    const res = await fetch(`${API_BASE}/teacher/dashboard`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getStudents(params?: { is_active?: boolean }) {
    const query = new URLSearchParams();
    if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
    const res = await fetch(`${API_BASE}/teacher/students?${query}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getStudentChats(studentId: number) {
    const res = await fetch(`${API_BASE}/teacher/students/${studentId}/chats`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async viewChat(sessionId: string) {
    const res = await fetch(`${API_BASE}/teacher/chats/${sessionId}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getActivity(limit: number = 20) {
    const res = await fetch(`${API_BASE}/teacher/activity?limit=${limit}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async createStudent(data: { name: string; email: string; password: string; year_group?: string }) {
    const res = await fetch(`${API_BASE}/teacher/students`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async generateInviteCode(studentId: number) {
    const res = await fetch(`${API_BASE}/teacher/students/${studentId}/invite-code`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
};

export const documentsApi = {
  async list(params?: { key_stage?: string; subject?: string; exam_board?: string; status?: string; kb_type?: string }) {
    const query = new URLSearchParams();
    if (params?.key_stage) query.set("key_stage", params.key_stage);
    if (params?.subject) query.set("subject", params.subject);
    if (params?.exam_board) query.set("exam_board", params.exam_board);
    if (params?.status) query.set("status", params.status);
    if (params?.kb_type) query.set("kb_type", params.kb_type);
    const res = await fetch(`${API_BASE}/documents?${query}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async upload(files: File[], keyStage: string, subject: string, examBoard: string, tier: string, kb_type: string = "course_material") {
    const token = getToken();
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("key_stage", keyStage);
    form.append("subject", subject);
    form.append("exam_board", examBoard);
    form.append("tier", tier);
    form.append("kb_type", kb_type);
    const res = await fetch(`${API_BASE}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return handleResponse(res);
  },

  async scrape(url: string, title: string, keyStage: string, subject: string, examBoard: string, tier: string, unitName?: string, kb_type: string = "course_material") {
    const res = await fetch(`${API_BASE}/documents/scrape`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url, title, key_stage: keyStage, subject, exam_board: examBoard, tier, unit_name: unitName, kb_type }),
    });
    return handleResponse(res);
  },

  async importLink(url: string, title: string, keyStage: string, subject: string, examBoard: string, tier: string, unitName: string | undefined, sourceType: string, kb_type: string = "course_material") {
    const res = await fetch(`${API_BASE}/documents/import-link`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url, title, key_stage: keyStage, subject, exam_board: examBoard, tier, unit_name: unitName, source_type: sourceType, kb_type }),
    });
    return handleResponse(res);
  },

  async retry(documentId: number) {
    const res = await fetch(`${API_BASE}/documents/${documentId}/retry`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async remove(documentId: number) {
    const res = await fetch(`${API_BASE}/documents/${documentId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete document");
  },
};

export const subscriptionApi = {
  async getPlans() {
    const res = await fetch(`${API_BASE}/subscription/plans`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async subscribe(planName: string) {
    const res = await fetch(`${API_BASE}/subscription/subscribe`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ plan_name: planName }),
    });
    return handleResponse(res);
  },

  async getHistory() {
    const res = await fetch(`${API_BASE}/subscription/history`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getTransactions() {
    const res = await fetch(`${API_BASE}/subscription/transactions`, { headers: authHeaders() });
    return handleResponse(res);
  },
};

export const parentApi = {
  async getDashboard() {
    const res = await fetch(`${API_BASE}/parent/dashboard`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getStudents() {
    const res = await fetch(`${API_BASE}/parent/students`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getStudentProgress(studentId: number) {
    const res = await fetch(`${API_BASE}/parent/students/${studentId}/progress`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getStudentChats(studentId: number) {
    const res = await fetch(`${API_BASE}/parent/students/${studentId}/chats`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getStudentAssessments(studentId: number) {
    const res = await fetch(`${API_BASE}/parent/students/${studentId}/assessments`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async linkWithCode(code: string) {
    const res = await fetch(`${API_BASE}/parent/link`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ code }),
    });
    return handleResponse(res);
  },

  async linkStudent(code: string) {
    const res = await fetch(`${API_BASE}/parent/link`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ code }),
    });
    return handleResponse(res);
  },
};

export const assessmentsApi = {
  async start(data: { chat_session_id?: string; subject: string; key_stage: string; topic: string }) {
    const res = await fetch(`${API_BASE}/assessments/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async submitAnswer(assessmentId: number, data: { question_index: number; student_answer: number }) {
    const res = await fetch(`${API_BASE}/assessments/${assessmentId}/answer`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async complete(assessmentId: number) {
    const res = await fetch(`${API_BASE}/assessments/${assessmentId}/complete`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
  async get(assessmentId: number) {
    const res = await fetch(`${API_BASE}/assessments/${assessmentId}`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async listForStudent(studentId: number) {
    const res = await fetch(`${API_BASE}/assessments/student/${studentId}`, { headers: authHeaders() });
    return handleResponse(res);
  },
};

export const gamificationApi = {
  async getDashboard() {
    const res = await fetch(`${API_BASE}/gamification/dashboard`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getProfile() {
    const res = await fetch(`${API_BASE}/gamification/profile`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getMastery() {
    const res = await fetch(`${API_BASE}/gamification/mastery`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async checkStreak() {
    const res = await fetch(`${API_BASE}/gamification/streak-check`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
  async getNextTopics(subject?: string, keyStage?: string) {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (keyStage) params.set("key_stage", keyStage);
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/gamification/next-topics${qs ? "?" + qs : ""}`, { headers: authHeaders() });
    return handleResponse(res);
  },
};

export const lessonApi = {
  async generatePlan(data: {
    subject: string;
    topic: string;
    subtopic?: string;
    goal: string;
    duration_minutes: number;
    appointment_id?: number;
  }) {
    const res = await fetch(`${API_BASE}/lessons/generate-plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
};

export const assignmentsApi = {
  async getMy() {
    const res = await fetch(`${API_BASE}/assignments/my`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async startAssignment(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/assignments/my/${id}/start`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Failed to start assignment");
    }
  },
  async completeAssignment(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/assignments/my/${id}/complete`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Failed to complete assignment");
    }
  },
};

export const settingsApi = {
  async getLearningPreferences() {
    const res = await fetch(`${API_BASE}/settings/learning-preferences`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async updateLearningPreferences(data: Record<string, unknown>) {
    const res = await fetch(`${API_BASE}/settings/learning-preferences`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async updateProfile(data: { name?: string; year_group?: string; key_stage?: string }) {
    const res = await fetch(`${API_BASE}/settings/profile`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async updateNotifications(data: Record<string, boolean>) {
    const res = await fetch(`${API_BASE}/settings/notifications`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async changePassword(data: { current_password: string; new_password: string }) {
    const res = await fetch(`${API_BASE}/settings/change-password`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
};

export const lessonsApi = {
  async getAvailableFilters() {
    const res = await fetch(`${API_BASE}/lessons/available-filters`, { headers: authHeaders() });
    return handleResponse<{ subjects: string[]; key_stages: string[] }>(res);
  },
  async getUnits(subject: string, keyStage: string) {
    const query = new URLSearchParams({ subject, key_stage: keyStage });
    const res = await fetch(`${API_BASE}/lessons/units?${query}`, { headers: authHeaders() });
    return handleResponse<{ units: Array<{ id: number; title: string; unit_name: string }> }>(res);
  },
  async getTopics(subject: string, keyStage: string) {
    const query = new URLSearchParams({ subject, key_stage: keyStage });
    const res = await fetch(`${API_BASE}/lessons/topics?${query}`, { headers: authHeaders() });
    return handleResponse<{ topics: Array<{ unit_name: string; document_count: number }> }>(res);
  },
  async getSubtopics(subject: string, unitName: string) {
    const query = new URLSearchParams({ subject, unit_name: unitName });
    const res = await fetch(`${API_BASE}/lessons/subtopics?${query}`, { headers: authHeaders() });
    return handleResponse<{ subtopics: string[] }>(res);
  },
  async create(data: {
    student_id: number;
    subject: string;
    key_stage: string;
    unit_name?: string;
    subtopic?: string;
    ability_level: string;
    goal: string;
    appointment_id?: number;
  }) {
    const res = await fetch(`${API_BASE}/lessons/create`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async start(id: number) {
    const res = await fetch(`${API_BASE}/lessons/${id}/start`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
  async get(id: number) {
    const res = await fetch(`${API_BASE}/lessons/${id}`, { headers: authHeaders() });
    return handleResponse(res);
  },
};

// Curriculum sourced from the Resource Hub mirror (rh_* tables).
export interface HubSubject { id: number; name: string; }
export interface Tutor { id: string; name: string; gender: string; emoji: string; blurb: string; }
export interface HubUnit { id: number; title: string; unit_number: number | null; has_resources: boolean; }
export interface HubTopic { id: number; title: string; }

export const curriculumApi = {
  async getKeyStages() {
    const res = await fetch(`${API_BASE}/curriculum/keystages`, { headers: authHeaders() });
    return handleResponse<{ keystages: string[] }>(res);
  },
  async getYears(keyStage?: string) {
    const query = keyStage ? `?${new URLSearchParams({ keyStage })}` : "";
    const res = await fetch(`${API_BASE}/curriculum/years${query}`, { headers: authHeaders() });
    return handleResponse<{ years: string[] }>(res);
  },
  async getSubjects(keyStage?: string, yearGroup?: string) {
    const params = new URLSearchParams();
    if (keyStage) params.set("keyStage", keyStage);
    if (yearGroup) params.set("yearGroup", yearGroup);
    const qs = params.toString() ? `?${params}` : "";
    const res = await fetch(`${API_BASE}/curriculum/subjects${qs}`, { headers: authHeaders() });
    return handleResponse<{ subjects: HubSubject[] }>(res);
  },
  async getUnits(subjectId: number, keyStage?: string, yearGroup?: string) {
    const params = new URLSearchParams({ subjectId: String(subjectId) });
    if (keyStage) params.set("keyStage", keyStage);
    if (yearGroup) params.set("yearGroup", yearGroup);
    const res = await fetch(`${API_BASE}/curriculum/units?${params}`, { headers: authHeaders() });
    return handleResponse<{ units: HubUnit[] }>(res);
  },
  async getTopics(unitId: number) {
    const query = new URLSearchParams({ unitId: String(unitId) });
    const res = await fetch(`${API_BASE}/curriculum/topics?${query}`, { headers: authHeaders() });
    return handleResponse<{ topics: HubTopic[] }>(res);
  },
  async getTutors() {
    const res = await fetch(`${API_BASE}/curriculum/tutors`, { headers: authHeaders() });
    return handleResponse<{ tutors: Tutor[]; default: string }>(res);
  },
  // Public URL for a short spoken sample in the tutor's voice (playable via <audio>).
  tutorPreviewUrl(tutorId: string) {
    return `${API_BASE}/curriculum/tutors/${encodeURIComponent(tutorId)}/preview`;
  },
  async triggerSync(target: "all" | "curriculum" | "resources" = "all") {
    const query = new URLSearchParams({ target });
    const res = await fetch(`${API_BASE}/curriculum/sync?${query}`, {
      method: "POST",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
  async getSyncStatus() {
    const res = await fetch(`${API_BASE}/curriculum/sync/status`, { headers: authHeaders() });
    return handleResponse(res);
  },
};

export const slidesApi = {
  generate: async (
    text: string,
    subject: string,
    keyStage: string,
    appointmentId?: number,
    existingTopics?: string[],
  ): Promise<{ slide_id: number; status: string; topic: string } | null> => {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/slides/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text,
        subject,
        key_stage: keyStage,
        appointment_id: appointmentId,
        existing_topics: existingTopics ?? [],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.slide_id != null ? data : null;
  },

  getSlide: async (slideId: number): Promise<import("../types").SlideData | null> => {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/slides/${slideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  },

  getSessionSlides: async (appointmentId: number): Promise<import("../types").SlideData[]> => {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/slides/session/${appointmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return res.json();
  },
};

export const sessionsApi = {
  async startPractice(appointmentId: number): Promise<import("../types").Assessment> {
    const res = await fetch(`${API_BASE}/sessions/${appointmentId}/practice`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    return handleResponse(res);
  },
  async startTest(appointmentId: number, body?: { topic?: string }): Promise<import("../types").Assessment> {
    const res = await fetch(`${API_BASE}/sessions/${appointmentId}/test`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body || {}),
    });
    return handleResponse(res);
  },
  async getLatestPractice(appointmentId: number): Promise<import("../types").Assessment | null> {
    const res = await fetch(`${API_BASE}/sessions/${appointmentId}/practice/latest`, {
      headers: authHeaders(),
    });
    if (res.status === 404) return null;
    return handleResponse(res);
  },
  async getLatestTest(appointmentId: number): Promise<import("../types").Assessment | null> {
    const res = await fetch(`${API_BASE}/sessions/${appointmentId}/test/latest`, {
      headers: authHeaders(),
    });
    if (res.status === 404) return null;
    return handleResponse(res);
  },
};

export const appointmentsApi = {
  async getTeachers() {
    const res = await fetch(`${API_BASE}/appointments/teachers`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async book(data: {
    student_id: number; teacher_id?: number; subject: string; key_stage: string;
    title: string; scheduled_at: string; duration_minutes?: number;
    description?: string; payment_amount?: number; passcode?: string;
    learn_mode?: string; subtopic?: string;
  }) {
    const res = await fetch(`${API_BASE}/appointments/book`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
  async list(status?: string) {
    const query = status ? `?status=${status}` : "";
    const res = await fetch(`${API_BASE}/appointments${query}`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async get(id: number) {
    const res = await fetch(`${API_BASE}/appointments/${id}`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async updateStatus(id: number, status: string) {
    const res = await fetch(`${API_BASE}/appointments/${id}/status`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    return handleResponse(res);
  },
  async checkAvailability(studentId: number) {
    const res = await fetch(`${API_BASE}/appointments/availability?student_id=${studentId}`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async getBriefing(appointmentId: number) {
    const res = await fetch(`${API_BASE}/appointments/${appointmentId}/briefing`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async joinSession(appointmentId: number, passcode: string) {
    const res = await fetch(`${API_BASE}/appointments/${appointmentId}/join`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ passcode }),
    });
    return handleResponse(res);
  },
  async getReport(id: number) {
    const res = await fetch(`${API_BASE}/appointments/${id}/report`, { headers: authHeaders() });
    return handleResponse(res);
  },
  async uploadLessonFile(appointmentId: number, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    const token = getToken();
    await fetch(`${API_BASE}/appointments/${appointmentId}/lesson-files`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
  },
};

// ── Legal / privacy / compliance ────────────────────────────────────────────────────────
export interface LegalDocSummary { doc_key: string; title: string; summary: string; version: string; requires_consent: boolean; is_draft: boolean; published_at: string | null; }
export interface LegalDocFull extends LegalDocSummary { content: string; effective_at: string | null; }
export interface PendingConsent { doc_key: string; version: string; title: string; summary: string; }
export interface DataRequestT { id: number; request_type: string; status: string; details: string | null; resolution_note: string | null; created_at: string; resolved_at: string | null; }

export const legalApi = {
  async documents() { return handleResponse<{ documents: LegalDocSummary[] }>(await fetch(`${API_BASE}/legal/documents`)); },
  async document(key: string) { return handleResponse<LegalDocFull>(await fetch(`${API_BASE}/legal/documents/${key}`)); },
  async pendingConsents() { return handleResponse<{ pending: PendingConsent[] }>(await fetch(`${API_BASE}/legal/consents/pending`, { headers: authHeaders() })); },
  async acceptAll(items: { doc_key: string; version: string }[]) { return handleResponse(await fetch(`${API_BASE}/legal/consents/accept-all`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ items }) })); },
  async myConsents() { return handleResponse<{ acceptances: { doc_key: string; version: string; accepted_at: string }[] }>(await fetch(`${API_BASE}/legal/consents/mine`, { headers: authHeaders() })); },
  async createDataRequest(request_type: string, details?: string, subject_user_id?: number) { return handleResponse<{ id: number; status: string }>(await fetch(`${API_BASE}/legal/data-requests`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ request_type, details, subject_user_id }) })); },
  async dataRequests() { return handleResponse<{ requests: DataRequestT[] }>(await fetch(`${API_BASE}/legal/data-requests`, { headers: authHeaders() })); },
};

// ── School verification (feature 04) ────────────────────────────────────────────────────
export interface SchoolVerification {
  id: number; name: string; legal_name: string | null; country: string | null; website: string | null;
  domain: string | null; school_type: string | null; identifier: string | null; address: string | null;
  contact_email: string | null; contact_phone: string | null; verification_status: string;
  verification_notes: string | null; suspended_reason: string | null; submitted_at: string | null; reviewed_at: string | null;
}
export interface VerificationEvent { from: string | null; to: string; note: string | null; actor_user_id: number | null; created_at: string; }
export interface EvidenceDoc { id: number; filename: string; content_type: string; size: number; scan_status: string; uploaded_at: string; }

export const schoolVerificationApi = {
  async me() { return handleResponse<{ school: SchoolVerification; events: VerificationEvent[]; evidence: EvidenceDoc[]; editable: boolean }>(await fetch(`${API_BASE}/school-verification/me`, { headers: authHeaders() })); },
  async updateMe(body: Partial<SchoolVerification>) { return handleResponse(await fetch(`${API_BASE}/school-verification/me`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) })); },
  async submit() { return handleResponse<{ status: string; warnings: string[] }>(await fetch(`${API_BASE}/school-verification/me/submit`, { method: "POST", headers: authHeaders() })); },
  async uploadEvidence(file: File) {
    const fd = new FormData(); fd.append("file", file);
    const token = localStorage.getItem("token");
    return handleResponse<{ id: number; scan_status: string }>(await fetch(`${API_BASE}/school-verification/me/evidence`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd }));
  },
  evidenceDownloadUrl(docId: number) { return `${API_BASE}/school-verification/evidence/${docId}/download`; },
  // administrator
  async applications(status?: string) { const q = status ? `?status=${status}` : ""; return handleResponse<{ applications: SchoolVerification[] }>(await fetch(`${API_BASE}/school-verification/applications${q}`, { headers: authHeaders() })); },
  async application(id: number) { return handleResponse<{ school: SchoolVerification; events: VerificationEvent[]; evidence: EvidenceDoc[]; duplicate_warnings: string[] }>(await fetch(`${API_BASE}/school-verification/applications/${id}`, { headers: authHeaders() })); },
  async transition(id: number, to_status: string, note?: string) { return handleResponse<{ status: string }>(await fetch(`${API_BASE}/school-verification/applications/${id}/transition`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ to_status, note }) })); },
};
