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

  async getChat(chatId: number) {
    const res = await fetch(`${API_BASE}/chat/${chatId}`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async deleteChat(chatId: number) {
    const res = await fetch(`${API_BASE}/chat/${chatId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error("Failed to delete chat");
    }
  },

  async sendMessage(message: string, chatId?: number) {
    const res = await fetch(`${API_BASE}/chat/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message, chat_id: chatId }),
    });
    return handleResponse(res);
  },

  streamMessage(
    message: string,
    chatId: number | null,
    onEvent: (event: { type: string; content?: string; chat_id?: number }) => void,
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
      body: JSON.stringify({ message, chat_id: chatId }),
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
