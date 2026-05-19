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

export const authApi = {
  async register(name: string, email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
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

  async getMe() {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
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

  streamMessage(
    message: string,
    sessionId: string | null,
    onEvent: (event: { type: string; content?: string; session_id?: string }) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ) {
    const token = getToken();
    const controller = new AbortController();

    fetch(`${API_BASE}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, session_id: sessionId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Stream request failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              onEvent(parsed);
            } catch {
              // skip malformed lines
            }
          }
        }
        onDone();
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError(err);
        }
      });

    return () => controller.abort();
  },

  streamQuizFeedback(
    sessionId: string,
    topic: string,
    score: number,
    strong: string[],
    weak: string[],
    onEvent: (event: { type: string; content?: string; session_id?: string }) => void,
    onDone: () => void,
    onError: (err: Error) => void,
    questionDetails?: Array<{ question_text: string; chosen_text: string; correct_text: string; is_correct: boolean }>
  ) {
    const token = getToken();
    const controller = new AbortController();

    fetch(`${API_BASE}/chat/quiz-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, topic, score, strong, weak, question_details: questionDetails }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Quiz feedback request failed");
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            try { onEvent(JSON.parse(trimmed.slice(6))); } catch { /* skip */ }
          }
        }
        onDone();
      })
      .catch((err) => { if (err.name !== "AbortError") onError(err); });

    return () => controller.abort();
  },
};

export const voiceApi = {
  async speak(text: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/voice/speak`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("TTS request failed");
    return res.blob();
  },
};

export const adminApi = {
  async getDashboard() {
    const res = await fetch(`${API_BASE}/admin/dashboard`, { headers: authHeaders() });
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
    student_id: number; teacher_id: number; subject: string; key_stage: string;
    title: string; scheduled_at: string; duration_minutes?: number;
    description?: string; payment_amount?: number; passcode?: string;
    learn_mode?: string;
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
