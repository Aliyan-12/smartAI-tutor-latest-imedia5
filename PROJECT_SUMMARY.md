# SmartAI Tutor — Project Summary

The complete SmartAI Tutor codebase is ready. Here's a summary of what was built:

---

## Backend (FastAPI) — `backend/`

| Layer | Files | Purpose |
|------------|---------------------------------------------------|------------------------------------------------|
| Core | `config.py`, `security.py` | Settings from env vars, JWT + bcrypt utilities |
| DB | `session.py`, `init_db.py` | Async SQLAlchemy engine, auto-creates tables + pgvector extension |
| Models | `user.py`, `chat.py` | `users`, `chats`, `messages` ORM models |
| Schemas | `user.py`, `chat.py` | Pydantic validation for all request/response payloads |
| Services | `user_service.py`, `chat_service.py`, `gemini_service.py`, `voice_service.py` | Business logic separated from routes |
| Routers | `auth.py`, `chat.py`, `voice.py`, `health.py` | REST + WebSocket endpoints |
| Middleware | `auth.py`, `rate_limit.py` | JWT bearer guard, per-IP rate limiting |

**Key features:**
- Gemini API via OpenAI-compatible client with streaming (SSE + WebSocket)
- Auto-generated chat titles via Gemini
- Chat history context (last 20 messages) sent with each request
- TTS via gTTS, STT via Whisper (graceful fallback if not installed)

---

## Frontend (React + TypeScript + Vite) — `frontend/`

| Layer | Files | Purpose |
|------------|-----------------------------------------------|---------------------------------------------------|
| Context | `AuthContext.tsx` | Global auth state, JWT persistence |
| Hooks | `useChat.ts`, `useVoice.ts` | Chat streaming logic, mic recording + TTS playback |
| Services | `api.ts` | Typed API client with SSE stream parser |
| Pages | `ChatPage`, `LoginPage`, `RegisterPage` | Full page layouts |
| Components | `Sidebar`, `ChatWindow`, `ChatInput`, `WelcomeScreen` | Reusable UI pieces |

**Key features:**
- SSE streaming with real-time token rendering
- Markdown rendering for AI responses
- Voice input (MediaRecorder to transcribe) and output (TTS playback)
- Dark theme, responsive layout, chat sidebar with CRUD

---

## Ports

- **Backend:** `8001`
- **Frontend dev:** `5173` (Vite proxies `/api` to `8001`)
- **Frontend production (Docker):** `3000` (nginx proxies to backend)
- **PostgreSQL:** `5432`

---

## Quick Start

```bash
# 1. Set your Gemini key
cp .env.example .env   # edit GEMINI_API_KEY

# 2. Launch everything
docker-compose up --build

# 3. Open http://localhost:3000
```
