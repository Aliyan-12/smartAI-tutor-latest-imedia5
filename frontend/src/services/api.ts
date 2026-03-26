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
    throw new Error(body.detail || `Request failed with status ${response.status}`);
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

  async transcribe(audioBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    const token = getToken();
    const res = await fetch(`${API_BASE}/voice/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) throw new Error("Transcription failed");
    const data = await res.json();
    return data.text;
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

  async viewChat(sessionId: string) {
    const res = await fetch(`${API_BASE}/admin/chats/${sessionId}`, { headers: authHeaders() });
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
