# SmartAI Tutor — Project Summary

The complete SmartAI Tutor codebase is ready. Here's a summary of what was built:

---

## Backend (FastAPI) — `backend/app/`

| Layer | Files | Purpose |
|------------|---------------------------------------------------|------------------------------------------------|
| Core | `config.py`, `security.py` | Settings from env vars, JWT + bcrypt utilities |
| DB | `session.py`, `init_db.py` | Async SQLAlchemy engine, pgvector extension |
| Models | `user.py`, `chat.py`, `subscription.py` | `users`, `chats`, `messages`, `subscriptions`, `credit_transactions` ORM models |
| Schemas | `user.py`, `chat.py`, `subscription.py` | Pydantic validation for all request/response payloads |
| Services | `user_service.py`, `chat_service.py`, `gemini_service.py`, `voice_service.py`, `credit_service.py` | Business logic separated from routes |
| Routers | `auth.py`, `chat.py`, `voice.py`, `health.py`, `admin.py`, `teacher.py`, `subscription.py` | REST + WebSocket endpoints |
| Middleware | `auth.py`, `rate_limit.py` | JWT bearer guard, role-based access control, per-IP rate limiting |
| Scripts | `setup.py`, `seed.py` | Database migration and seed data |

**Key features:**
- Multi-role system: Admin, Teacher, Student
- Credit/token-based subscription model for students
- Admin dashboard API: full CRUD on users, credit adjustments, view all chats
- Teacher dashboard API: view students, monitor chat activity
- Gemini API via OpenAI-compatible client with streaming (SSE + WebSocket)
- Auto-generated chat titles via Gemini
- Chat history context (last 20 messages) sent with each request
- Credit deduction per AI message with transaction audit log
- TTS via gTTS, STT via Whisper (graceful fallback if not installed)

---

## Frontend (React + TypeScript + Vite) — `frontend/`

| Layer | Files | Purpose |
|------------|-----------------------------------------------|---------------------------------------------------|
| Context | `AuthContext.tsx` | Global auth state, JWT persistence |
| Hooks | `useChat.ts`, `useVoice.ts` | Chat streaming logic, mic recording + TTS playback |
| Services | `api.ts` | Typed API client with SSE stream parser, admin/teacher/subscription APIs |
| Pages | `ChatPage`, `LoginPage`, `RegisterPage`, `AdminDashboard`, `TeacherDashboard` | Role-based page layouts |
| Components | `Sidebar`, `ChatWindow`, `ChatInput`, `WelcomeScreen` | Reusable UI pieces |

**Key features:**
- Role-based routing: auto-redirects to correct dashboard on login
- Admin Dashboard: user management table, credit adjustments, stats overview
- Teacher Dashboard: student list, chat history viewer, recent activity feed
- Student Chat: credit balance display, real-time deduction
- SSE streaming with real-time token rendering
- Markdown rendering for AI responses
- Voice input (MediaRecorder to transcribe) and output (TTS playback)
- Dark theme, responsive layout, chat sidebar with CRUD

---

## Roles

| Role | Access |
|---------|--------|
| Admin | Full control: manage all users, view all chats, adjust credits, create teachers/students |
| Teacher | Monitor students, view student chat histories, see recent activity |
| Student | Chat with AI tutor, voice conversation, credit-based usage |

---

## Subscription Plans

| Plan | Credits | Price |
|-----------|---------|-------|
| Free | 50 | $0.00 |
| Starter | 500 | $9.99 |
| Pro | 2,000 | $29.99 |
| Unlimited | 10,000 | $79.99 |

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

# 2. Create tables and seed data
cd backend
python -m app.setup
python -m app.seed

# 3. Start the backend
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 4. Start the frontend (separate terminal)
cd frontend
npm install
npm run dev

# 5. Open http://localhost:5173
```

## Docker Start

```bash
cp .env.example .env   # edit GEMINI_API_KEY
docker-compose up --build
# Open http://localhost:3000
```

---

## Default Logins

| Role | Email | Password |
|---------|--------------------------|-------------|
| Admin | admin@smartai.com | admin123 |
| Teacher | teacher@smartai.com | teacher123 |
| Student | student@smartai.com | student123 |
