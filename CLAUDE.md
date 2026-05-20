# SmartAI Tutor — Claude Code Context

## What This System Is

SmartAI Tutor is a commercial AI-powered tutoring platform for UK GCSE students (Key Stages 1–5). It delivers structured AI lessons using Google Gemini 2.5 Flash, a RAG knowledge base built on pgvector, and real-time voice via the Gemini Live API. The platform is deployed at **dev.smartaitutor.online**.

---

## Stack & Ports

| Layer | Tech | Port |
|-------|------|------|
| Frontend | React 18 + TypeScript + Vite | 5173 (dev) / 3000 (Docker) |
| Backend | FastAPI (Python 3.11) | 8001 |
| Database | PostgreSQL 17 + pgvector 0.8.2 | 5432 |
| AI — text | Google Gemini 2.5 Flash (streaming SSE) | — |
| AI — voice | Gemini Live API (bidirectional WebSocket) | — |
| AI — embed | Gemini embedding-001 (768d vectors) | — |

Vector search: pgvector HNSW cosine, top-5 chunks, min 0.3 similarity.

---

## Four User Roles

| Role | Dashboard route | Notes |
|------|-----------------|-------|
| admin | `/admin/dashboard` | Full platform control |
| teacher | `/teacher/dashboard` | Manage content + monitor students |
| student | `/dashboard` | Chat + AI lessons + sessions |
| parent | `/parent/dashboard` | Book sessions + track children |

### Default Test Credentials
```
admin@smartai.com    / admin123
teacher@smartai.com  / teacher123
student@smartai.com  / student123
parent@smartai.com   / parent123
```

---

## Project Structure

```
backend/app/
  core/           — Config, JWT security
  db/             — Database session, init
  middleware/     — Auth guards, rate limiting
  models/         — SQLAlchemy models (users, chats, documents, appointments, assignments)
  routers/        — API endpoints (auth, chat, voice, admin, teacher, appointments, documents)
  schemas/        — Pydantic request/response models
  services/
    chat_service.py           — Chat CRUD + RAG context building
    gemini_service.py         — Gemini streaming + RAG injection
    embedding_service.py      — Gemini text-embedding-001
    retrieval_service.py      — pgvector cosine similarity search
    session_agent_service.py  — Session AI (5-phase lesson structure)
    document_service.py       — PDF/DOCX/PPTX extraction + chunking
    voice_service.py          — TTS (gTTS)
    credit_service.py         — Credit deduction + subscriptions
    user_service.py           — User CRUD

frontend/src/
  components/     — Sidebar, WelcomeScreen, ChatWindow, ChatInput, LottiePlayer, etc.
  context/        — AuthContext (JWT state)
  hooks/          — useChat (streaming SSE), useVoice (Gemini Live WebSocket)
  pages/          — All page components (see Navigation Rules below)
  services/       — api.ts (all API endpoints, typed)
  types/          — TypeScript interfaces
```

---

## How to Run

### Local dev
```bash
# Backend
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload \
  --ws-ping-timeout 300 --ws-ping-interval 30

# Frontend
cd frontend && npm run dev
```

### Docker (production-like)
```bash
docker compose up -d --build          # full rebuild
docker compose up -d --build frontend # rebuild frontend only
docker compose down && docker compose up -d --build  # if container name conflicts
```

---

## Specialized Claude Agents

These are defined in `.claude/agents/` and should be invoked for domain-specific work:

| File | Use for |
|------|---------|
| `.claude/agents/frontend.md` | All React/TypeScript/Vite tasks |
| `.claude/agents/backend.md` | All FastAPI/Python tasks |
| `.claude/agents/testing.md` | pytest / Vitest tests |

**Prefer direct edits with the Edit tool** over spawning agents when changes are small or critical — agents have occasionally reported success without writing to disk.

---

## Key Architecture Decisions

### AI Lesson Flow (the main student journey)
```
Dashboard → /lesson/setup → LessonSetupPage → creates appointment → 
/session/{id} → SessionPage → AI delivers 5-phase lesson
```

- `SessionPage.tsx` auto-joins if appointment has no passcode (no briefing screen)
- After join, if session is fresh (0 messages), auto-sends a human-readable start message after 800ms
- The start message format: `"Let's start our lesson on {topicText}! I'm ready to begin."`

### 5-Phase Lesson Structure (backend-enforced)
Every AI session follows this structure (injected via `build_session_system_prompt()` in `session_agent_service.py`):

1. **CONNECT** (10%) — warm opener, prior knowledge, goal-setting
2. **TEACH** (40%) — step-by-step explanations, examples, checking questions
3. **PRACTICE** (25%) — guided questions, adaptive difficulty, instant feedback
4. **APPLY** (15%) — independent challenge, detailed feedback
5. **REFLECT** (10%) — recap, strengths, next steps

The AI always leads; it never waits for the student to initiate.

### `__LESSON_START__` Intercept (backend)
- `backend/app/routers/chat.py` detects `message.content == "__LESSON_START__"`
- Skips saving it to the DB (so it doesn't appear as a user message)
- Substitutes a structured lesson-start instruction to Gemini
- **Note:** The frontend now sends human-readable text instead of this raw trigger

### RAG Knowledge Base
- Documents tagged by: Key Stage, Subject, Exam Board, Tier, Unit
- Chunks embedded with `gemini-embedding-001`, stored in pgvector with HNSW index
- Top-5 chunks retrieved per query at cosine similarity ≥ 0.3
- Injected into Gemini system prompt as context

### TTS Stale Closure Fix (SessionPage.tsx)
`ttsEnabledRef = useRef(true)` + effect to sync it. All 4 callbacks read `ttsEnabledRef.current` (not the `ttsEnabled` state) to avoid stale closure bugs when muting mid-stream.

---

## Navigation Rules (important — don't break these)

- All subject/lesson links → `/lesson/setup` (NEVER `/chat` for structured content)
- Post-session → `/dashboard` (NEVER `/student/dashboard`)
- Active session resume → `/session/{id}`
- Student dashboard route is `/dashboard` (not `/student/dashboard`)

---

## Student Sidebar Nav (current state)
Flat 6-item list — no dropdowns, no chat history, no learning time widget:
1. Home → `/dashboard`
2. My Sessions → `/sessions`
3. Subjects → `/lesson/setup`
4. My Progress → `/progress`
5. Messages (Soon — disabled)
6. Settings → `/settings`

Teacher & Parent sidebars use a singleton dropdown for "Sessions":
- `openDropdown` state (string | null)
- `toggleDropdown(id)` closes the current one and opens the new one
- Dropdown is auto-open when on the relevant route (route-based default)

---

## LessonSetupPage — 3 Adaptive Modes

`location.state.mode` controls the form behaviour:

| Mode | Triggered by | Behaviour |
|------|-------------|-----------|
| `'student'` | Direct nav | Normal interactive form (default) |
| `'teacher_homework'` | AssignmentsPage "Start" button | Locked fields, shows homework task card, button = "Start Homework Lesson" |
| `'parent_booked'` | Parent-booked appointment | Pre-filled from `sourceAppointment`, fields locked |

---

## Security Rules

**NEVER SSH into the production VPS (187.124.210.62) without explicit user confirmation.**
Always ask before running any `ssh`, `scp`, or remote command targeting that IP.

---

## Presenton Slides Integration

Real-time slide generation via Presenton iframe:
- DB model: stores `presenton_url` on sessions
- API flow: session creation triggers slide generation, URL returned to frontend
- Frontend embeds slides as iframe during session
- See memory file: `project_presenton_slides.md`

---

## Common Gotchas

1. **Docker container name conflict on rebuild** — run `docker compose down` first
2. **Agent writes not persisting** — if a sub-agent reports success but the file looks unchanged, use the Edit tool directly
3. **pgvector dimension mismatch** — Gemini embedding-001 produces 768d vectors; schema must match
4. **WS ping settings required** — voice WebSocket drops without `--ws-ping-timeout 300 --ws-ping-interval 30`
5. **Credits** prop on Sidebar is passed by parent but not rendered (learning time widget was removed)
