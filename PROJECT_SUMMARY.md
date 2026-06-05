# SmartAI Tutor — Project Summary

> **Last updated:** 2026-06-05
> **Recent changes:** Both chat and session now run over **one WebSocket each** (`/api/chat/ws`, `/api/sessions/ws`) with segment-bundled Kokoro TTS · **Gemini Live removed** — voice is a custom STT → turn → TTS loop on the same socket · **SSE chat pipeline removed** (`/api/chat/stream`, `/api/chat/quiz-feedback`) · Services consolidated (rag/platform/voice_agent/session_agent/lesson) · **Two-LLM split** (`get_llm` session vs `get_chat_llm` chat) · `chat_tools` (web/deep search) for simple chat · Neutral-bridge fillers (classifier removed) · Presenton/slides removed

SmartAI Tutor is an AI-powered tutoring platform built for UK GCSE curriculum (Key Stages 1-5). It provides personalized learning through text chat and real-time voice conversation, grounded in actual course materials via a Retrieval-Augmented Generation (RAG) system. Teachers and admins upload curriculum content (PDF, DOCX, PPTX) organized by Key Stage, subject, exam board, and tier. When students ask questions, the system automatically retrieves relevant document chunks using pgvector similarity search and injects them into the Gemini AI prompt, producing accurate, curriculum-aligned answers.

---

## System Architecture

```
Teacher uploads documents (PDF/DOCX/PPTX)
    |
    v
Text Extraction -> Chunking (500 tokens, 50 overlap) -> Gemini Embedding (768d) -> pgvector HNSW storage
    |
    v
Student asks question
    |
    v
Embed query -> pgvector cosine search (HNSW index) -> Top-5 chunks (min similarity 0.3)
    |
    v
Chunks injected into Gemini prompt as [KNOWLEDGE BASE CONTEXT]
+ Student preferences (learning style, teaching pace) injected into system prompt
+ Appointment/session context injected (subject, topics, ability level)
    |
    v
Gemini generates curriculum-grounded response (LangChain astream; tool calls for quiz/homework/mastery/research)
    |
    v
Backend orchestrates one WebSocket per chat/session: reply streamed as ordered sentence
"segments" (text + bundled Kokoro TTS audio + duration). Voice turns transcribe mic audio
(STT) first, then run the identical turn pipeline.
    |
    v
XP awarded -> Topic mastery updated -> Session report generated (quiz score, strong/weak areas)
```

---

## UK GCSE Curriculum Structure

Documents are organized following the UK national curriculum hierarchy:

| Field | Values | Purpose |
|------------|---------------------------------------------------|----------------------------------------|
| key_stage | KS1, KS2, KS3, KS4, KS5 | Year group level (ages 5-18) |
| subject | Biology, Chemistry, Physics, Maths, English, etc. | Subject area |
| exam_board | AQA, Edexcel, OCR, WJEC, None | GCSE exam board (KS4+) |
| tier | Foundation, Higher, None | Exam difficulty tier |
| unit_name | Free text | E.g. "Eukaryotic and Prokaryotic Cells" |

### Key Stage Reference

| Key Stage | Years | Ages | Level |
|-----------|-------|-------|-------|
| KS1 | 1-2 | 5-7 | Primary |
| KS2 | 3-6 | 7-11 | Primary |
| KS3 | 7-9 | 11-14 | Secondary |
| KS4 | 10-11 | 14-16 | GCSE |
| KS5 | 12-13 | 16-18 | A-Level |

---

## User Roles

| Role | Access |
|---------|--------|
| Admin | Full control: manage all users, view all chats, adjust credits, manage knowledge base, dashboard stats |
| Teacher | Upload documents, create/manage students, view student chat histories, book sessions, session reports, activity feed, generate invite codes |
| Student | Chat with AI tutor (text + voice), join sessions, take quizzes, view progress/gamification, assignments |
| Parent | Link to children via invite code, book sessions, view child progress/reports/chat history, session notifications |

---

## Backend (FastAPI) — `backend/app/`

| Layer | Files | Purpose |
|-----------|------------------------------------------------------|----------------------------------------------|
| Core | `config.py`, `security.py` | Settings, JWT + bcrypt, RAG config |
| DB | `session.py`, `init_db.py` | Async SQLAlchemy + asyncpg, pgvector HNSW index |
| Models | `user.py`, `chat.py`, `documents.py`, `subscription.py`, `appointment.py`, `lesson_plan.py`, `assessment.py`, `assignment.py`, `student_profile.py`, `parent_student.py` | ORM models for all entities |
| Schemas | `user.py`, `chat.py`, `documents.py`, `subscription.py`, `appointment.py`, `lesson.py`, `assessment.py`, `gamification.py`, `settings.py`, `assignment.py` | Pydantic request/response validation |
| Services | `gemini_service.py` (LangChain streaming, tool loop, MCQ), `llm_service.py` (`get_llm` session + `get_chat_llm` chat singletons), `rag_service.py` (embedding + pgvector retrieval — merged), `document_service.py`, `chat_service.py` (incl. simple-chat WS pipeline), `voice_agent_service.py` (Kokoro TTS + Gemini STT), `session_agent_service.py` (session prompts + segment/filler + WS turn loop), `lesson_service.py` (+ lesson structure), `platform_service.py` (credits/subscriptions + email + gamification + settings + scraper — merged), `appointment_service.py`, `assessment_service.py`, `assignment_service.py`, `user_service.py` | Business logic |
| Tools | `session_tools.py` (full session tool suite: quiz, homework, mastery, lesson-phase, evaluate, report, web/deep search), `chat_tools.py` (simple-chat subset: web/deep search) | LangChain `@tool` closures + `ToolContext` |
| Routers | `auth.py`, `chat.py`, `voice.py`, `documents.py`, `admin.py`, `teacher.py`, `parent.py`, `appointments.py`, `sessions.py`, `lessons.py`, `assessments.py`, `assignments.py`, `gamification.py`, `settings.py`, `subscription.py`, `health.py` | REST + WebSocket endpoints |
| Middleware | `auth.py`, `rate_limit.py` | JWT guard, role-based access, rate limiting |
| Scripts | `setup.py`, `seed.py`, `seed_voice_fillers.py` | DB setup/seed; pre-generate the Kokoro **neutral-bridge** filler clips (`python -m app.seed_voice_fillers`) |

### Key Backend Features

- **Multi-role system**: Admin, Teacher, Student, Parent with role-based access control (JWT + bcrypt)
- **RAG pipeline**: pgvector HNSW index (M=16, ef=64, cosine ops), Gemini text-embedding-001 (768d), top-5 chunks with min 0.3 similarity
- **Document processing**: PDF (pypdf), DOCX (python-docx), PPTX (python-pptx) extraction; 500-token chunks with 50-token overlap; batch embedding; status tracking (pending → ready/failed)
- **Chat**: two separate WebSocket pipelines — premium **session** (`/api/sessions/ws`, full tool suite, `get_llm`) and free **simple chat** (`/api/chat/ws`, `chat_tools` subset, `get_chat_llm`). Backend orchestrates each turn: saves the user message once, streams the reply as ordered sentence segments with bundled Kokoro audio, commits the assistant message once with the authoritative DB id (`turn_end`). Auto-generated titles, 20-message context window + RAG injection, per-message credit deduction. A per-turn `asyncio.wait_for` timeout means the socket can never hang.
- **Voice (custom loop)**: the mic is captured client-side with RMS silence-VAD (`useVoiceCapture`); each utterance is sent as `user_audio` over the **same** chat/session WebSocket, transcribed by Gemini STT (`voice_agent_service.speech_to_text`), run through the **identical** turn pipeline, and spoken back as the segment audio. **Kokoro-82M** (`af_sky`, local CPU, ~280 ms) powers all TTS (`text_to_speech`, also `/api/voice/speak` for "Read aloud"), pre-warmed in lifespan. (The old Gemini Live socket was removed.)
- **Neutral-bridge filler**: a tiny neutral phrase ("Okay.", "Right.", "Let me see.") + its Kokoro clip is sent at turn start to cover the <1 s before the first real segment; the **model's own first sentence** carries the actual reaction (praise/correction). The old situational-filler classifier was removed — only the `neutral` bucket in `seed_voice_fillers.py` remains, read by `session_agent_service.get_neutral_filler()`.
- **Session/Appointment system**: Teacher or parent books sessions; status flow (booked → confirmed → in_progress → completed/cancelled/terminated/paused); session passcode support
- **Quiz/Assessment system**: a `generate_quiz` session tool generates quiz questions during sessions; answer evaluation; scoring (score_percent, correct_answers); strong/weak topic analysis (quiz feedback rides the same session WebSocket via a `quiz_result` message)
- **Session reports**: Post-session AI-generated report (summary, quiz score, understanding level, strong areas, areas to improve, next session recommendation)
- **Lesson planning**: AI-generated lesson plans (plan_blocks JSONB), checkpoint/resume state, topic listing from knowledge base
- **Gamification**: XP awards per message/quiz/session; level progression; daily streaks; topic mastery (not_started → learning → proficient → mastered); XP dashboard; next-topic recommendations
- **Assignments/Homework**: Teacher creates homework; students see To Do / Completed tabs; AI tutor link for help
- **Student learning preferences**: Learning style, teaching pace, voice responses, show hints, auto-start next topic — injected into Gemini system prompt
- **Parent-student linking**: Invite codes generated by teachers; parents link via code; parents can book sessions and view all child reports
- **Credit system**: Default 100 credits on signup; per-message deduction; subscription plans; full transaction audit log; admin credit adjustments
- **Email notifications**: Booking confirmations sent to student and parent on appointment creation (dummy SMTP in dev)
- **Web scraping**: BeautifulSoup scraper for thenational.academy, resourcefullearning.co.uk, bbc.co.uk, khanacademy.org
- **Link imports**: OneDrive share links (via share API), Google Docs/Slides export links

---

## Frontend (React + TypeScript + Vite) — `frontend/`

| Layer | Files | Purpose |
|-----------|--------------------------------------------------|----------------------------------------------|
| Context | `AuthContext.tsx` | Global auth state, JWT persistence |
| Hooks | `useSessionChannel.ts` (chat/session WS client + ordered segment player), `useVoiceCapture.ts` (mic RMS-VAD → `user_audio`), `useVoice.ts` (single-shot "Read aloud" TTS), `useChat.ts` (dashboard list/credits) | Real-time pipeline + helpers |
| Services | `api.ts` | API client for all backend router groups (`sessionWsUrl`/`chatWsUrl` helpers) |
| Pages | See full list below | Role-based pages |
| Components | `Sidebar`, `ChatWindow`, `ChatInput`, `WelcomeScreen`, `StudentDashboard`, `StudentProgress`, `LessonSetupWizard`, `LessonSlide`, `PostSessionScreen`, `AssessmentMode` | Reusable UI |

### Pages

| Page | Route | Role |
|------|-------|------|
| LoginPage | /login | public |
| RegisterPage | /register | public |
| DashboardPage | /student/dashboard (alias: /dashboard) | student |
| ChatPage | /chat, /chat/:sessionId | student |
| SessionsPage | /sessions | student |
| SessionPage | /session/:appointmentId | student |
| SessionReportPage | /session/:id/report | student |
| LessonSetupPage | /lesson/setup | student |
| ProgressPage | /progress | student |
| AssignmentsPage | /assignments | student |
| SettingsPage | /settings | student |
| AdminDashboard | /admin/dashboard | admin |
| TeacherDashboard | /teacher/dashboard | teacher |
| KnowledgeBasePage | /teacher/knowledge | teacher |
| TeacherReportsPage | /teacher/reports | teacher |
| TeacherSettingsPage | /teacher/settings | teacher |
| AppointmentsPage | /appointments | teacher + parent |
| BookSessionPage | /appointments/new | teacher + parent |
| ParentDashboard | /parent/dashboard | parent |
| ParentReportsPage | /parent/reports | parent |
| ParentSettingsPage | /parent/settings | parent |

### Key Frontend Features

- **Role-based routing**: `/sessions` (student), `/admin` (admin), `/teacher` (teacher), `/parent` (parent)
- **Session UI (SessionPage)**: 3-panel layout — Lesson Slides (left), AI Avatar placeholder (center), Classroom Chat (right); Learn / Test tabs; quick prompts ("I need help", "Explain again", "Go slower"); Raise Hand button; session timer; XP counter; Pause/End controls; Read Aloud (TTS) toggle
- **Lesson Setup (LessonSetupPage)**: Gradient hero banner with XP/streak/level pills; 4 numbered step cards; Step 1 subject+key stage+topic selectors; Step 2 goal cards (4-col compact grid with radio circles: Homework Help, Learn from Scratch, Catch Up, Exam Revision); Step 3 duration cards (2×2 grid locked by key stage); Step 4 learn mode compact cards (AI Recommended, Slides, Worksheet, Quiz); right sidebar with live lesson preview (colored time pills), assignment panel, focus checklist; sticky "Start Lesson with AI Tutor" bar; pre-populates from `location.state.subject/goal`
- **Book Session (BookSessionPage)**: Same gradient header design as LessonSetupPage; 4 numbered step cards; Step 1 student+teacher selectors with availability badge; Step 2 subject/key-stage dropdowns + 5-column session goal compact cards; Step 3 date/time + duration cards; Step 4 passcode + notes; right sidebar with live session preview (lesson plan steps) + session summary + what happens next + availability bar; sticky "Confirm & Book Session" bar
- **Session reports**: Quiz score %, understanding level badge (Needs Support / Developing / Secure / Mastered), topics covered tags, strong areas (green dots), areas to improve (orange dots), next session recommendation; "Start New Lesson" → `/lesson/setup`, "Ask AI Tutor" → `/chat`
- **Chat page (ChatPage)**: "Start a structured lesson →" button above subject pills → `/lesson/setup`; subject pills for quick topic entry
- **Knowledge Base UI (KnowledgeBasePage)**: Course Material and Model Training tabs; tree view (KS → Subject → Exam Board → documents); PPTX/PDF/DOCX upload with full metadata; status badges (READY/FAILED/PENDING); retry and delete actions; scrape URL and link import forms
- **Student Progress (ProgressPage)**: Total study time, sessions done, questions correct, topics covered; learning velocity, quiz score trend, predicted accuracy, estimated completion; subject-by-subject breakdown; strengths and focus areas
- **Gamification sidebar widget**: Weekly learning time progress bar vs goal; Buy More Time button; XP badge in session header
- **My Sessions (SessionsPage)**: Active/paused session resume card; Recent Sessions and All Sessions tabs; subject filter; AI tutor tip card
- **Assignments (AssignmentsPage)**: To Do / Completed / All tabs; Calendar view button; "Ask AI Tutor" link for help
- **Settings (SettingsPage)**: Learning preferences (style, pace, voice, hints); notification preferences; account security
- **Real-time voice mode**: Mic button toggles hands-free voice on the existing chat/session WebSocket — `useVoiceCapture` records each utterance with client-side RMS silence-VAD, sends it as `user_audio`, and the spoken reply plays back as segment audio (text reveals in lockstep). Mic pauses while the tutor speaks (half-duplex). "Read aloud" buttons use single-shot `/api/voice/speak`
- **Unified sidebar**: Role-aware navigation with "Soon" labels on upcoming features

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------------------|---------------------------|
| POST | /api/auth/register | Create student account |
| POST | /api/auth/login | Sign in, receive JWT |
| GET | /api/auth/me | Get current user profile |

### Chat
| Method | Endpoint | Description |
|--------|---------------------------|------------------------------|
| GET | /api/chat/list | List student's chats |
| GET | /api/chat/credits | Get credit balance |
| GET | /api/chat/:sessionId | Get chat with messages |
| DELETE | /api/chat/:sessionId | Delete a chat |
| POST | /api/chat/for-appointment/:id | Get/create the chat bound to an appointment (session) |
| WS | /api/chat/ws | **Simple-chat pipeline** — text (no TTS) + voice (STT→TTS); `user_message`/`user_audio` → segment stream |

### Voice
| Method | Endpoint | Description |
|--------|---------------------------|------------------------------|
| POST | /api/voice/speak | Single-shot text-to-speech (Kokoro `af_sky`) — used by "Read aloud" |

### Documents (Knowledge Base)
| Method | Endpoint | Description |
|--------|-------------------------------|------------------------------|
| GET | /api/documents | List documents (kb_type filter) |
| GET | /api/documents/curriculum | Get curriculum metadata |
| POST | /api/documents/upload | Upload PDF/DOCX/PPTX files |
| POST | /api/documents/scrape | Scrape educational URL |
| POST | /api/documents/import-link | Import from OneDrive/GDocs |
| POST | /api/documents/:id/retry | Retry failed processing |
| DELETE | /api/documents/:id | Delete document + chunks |

### Admin
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/admin/dashboard | Dashboard stats |
| GET | /api/admin/users | List all users |
| POST | /api/admin/users | Create user (any role) |
| PATCH | /api/admin/users/:id | Update user |
| DELETE | /api/admin/users/:id | Delete user |
| POST | /api/admin/users/:id/credits | Adjust credits |
| GET | /api/admin/chats | List all student chats |
| GET | /api/admin/chats/:sessionId | View any chat |

### Teacher
| Method | Endpoint | Description |
|--------|---------------------------------------|--------------------------|
| GET | /api/teacher/dashboard | Dashboard stats |
| GET | /api/teacher/students | List students |
| POST | /api/teacher/students | Create student |
| GET | /api/teacher/students/:id/chats | Student's chat list |
| GET | /api/teacher/chats/:sessionId | View student chat |
| GET | /api/teacher/activity | Recent student questions |
| POST | /api/teacher/students/:id/invite-code | Generate invite code |

### Parent
| Method | Endpoint | Description |
|--------|---------------------------------------|--------------------------|
| GET | /api/parent/dashboard | Dashboard (linked children) |
| GET | /api/parent/students | List linked children |
| GET | /api/parent/students/:id/progress | Child progress + assessments |
| GET | /api/parent/students/:id/chats | Child's chat history |
| GET | /api/parent/students/:id/assessments | Child's assessments |
| POST | /api/parent/link | Link student via invite code |

### Appointments
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/appointments/teachers | List available teachers |
| POST | /api/appointments/book | Book appointment |
| GET | /api/appointments/:id | Get appointment details |
| PATCH | /api/appointments/:id | Update appointment status |
| DELETE | /api/appointments/:id | Cancel appointment |
| GET | /api/appointments/availability | Check teacher availability |
| POST | /api/appointments/:id/join | Student joins session |
| POST | /api/appointments/:id/start-session | Begin session |

### Sessions (premium session pipeline + quiz)
| Method | Endpoint | Description |
|--------|-----------------------------------------------|--------------------------|
| WS | /api/sessions/ws | **Session pipeline** — full tool suite, lesson logic, segment-bundled TTS, voice loop |
| POST | /api/sessions/:appointmentId/practice | Start/generate a practice quiz |
| GET | /api/sessions/:appointmentId/practice/latest | Latest practice attempt |
| POST | /api/sessions/:appointmentId/test | Start/generate a test quiz |
| GET | /api/sessions/:appointmentId/test/latest | Latest test attempt |

### Lessons
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/lessons/available-filters | Subjects/key stages with ready docs |
| GET | /api/lessons/units | Units for subject + key stage |
| GET | /api/lessons/topics | Topics from knowledge base |
| POST | /api/lessons/generate-plan | Generate AI lesson plan |
| GET | /api/lessons/:planId | Get lesson plan |
| POST | /api/lessons/:planId/checkpoint | Save session state |
| POST | /api/lessons/:planId/continue | Continue from checkpoint |

### Assessments
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| POST | /api/assessments/create | Create standalone assessment |
| GET | /api/assessments/:id | Get assessment |
| POST | /api/assessments/:id/submit | Submit assessment |
| GET | /api/assessments/list | List assessments |
| GET | /api/assessments/student/:id | Get student's assessments |

### Assignments (Homework)
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/assignments/my | Student's assignments |
| POST | /api/assignments/create | Create homework (teacher) |
| PATCH | /api/assignments/:id | Update assignment |
| DELETE | /api/assignments/:id | Delete assignment |

### Gamification
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/gamification/dashboard | Full dashboard (XP, mastery, daily plan) |
| GET | /api/gamification/profile | Student profile (XP, streaks) |
| GET | /api/gamification/mastery | All topic mastery records |
| GET | /api/gamification/mastery/:studentId | Mastery for specific student |
| POST | /api/gamification/streak-check | Update daily streak |
| GET | /api/gamification/next-topics | RAG-based topic recommendations |

### Settings
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/settings/learning-preferences | Get learning preferences |
| PATCH | /api/settings/learning-preferences | Update preferences |

### Subscription & Health
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/subscription/plans | List available plans |
| POST | /api/subscription/subscribe | Subscribe to plan |
| GET | /api/subscription/my-subscription | Current subscription |
| GET | /api/health | Health check |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | FastAPI (Python 3.11+) |
| Frontend | React 18 + TypeScript (Vite 6) |
| Database | PostgreSQL 17 + pgvector 0.8.2 |
| AI Model | Google Gemini via LangChain `ChatGoogleGenerativeAI` — two singletons: `get_llm()` (session/premium, `GEMINI_SESSION_MODEL`) and `get_chat_llm()` (free chat, `GEMINI_CHAT_MODEL`) |
| LLM orchestration | LangChain (`langchain-google-genai` ≥4.0) — async `astream()`, `with_structured_output()`, `@tool` calling |
| Embeddings | Gemini text-embedding-001 (768d with output_dimensionality) |
| Voice | Custom STT → turn → TTS loop on the chat/session WebSocket. STT: Gemini transcription; client-side RMS silence-VAD for end-of-utterance |
| TTS | Kokoro-82M (`af_sky`, local CPU, `kokoro` + `soundfile`); per-sentence segments; pre-warmed in lifespan |
| Vector Index | pgvector HNSW (M=16, ef=64, cosine similarity) |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Document parsing | pypdf, python-docx, python-pptx |
| Web scraping | BeautifulSoup4 (in `platform_service`) |
| Email | Dummy SMTP (dev), HTML templates (in `platform_service`) |
| Containerisation | Docker + Docker Compose (3 services: db, backend, frontend) |
| Reverse proxy | Nginx (inside frontend container for dev; host Nginx + Certbot for production) |

---

## Running the Project

### Option A — Docker (recommended, mirrors production)

```bash
# First run: build images
docker compose build

# Start all services
docker compose up -d

# View logs
docker compose logs -f backend

# After first start: initialise DB and seed default users
docker exec -w /app <project>-backend-1 python -m app.setup
docker exec -w /app <project>-backend-1 python -m app.seed

# Rebuild after frontend/backend code changes
docker compose build --no-cache frontend backend
docker compose up -d
```

Services started by Docker Compose:

| Service | Image / Build | Host Port | Purpose |
|---------|--------------|-----------|---------|
| db | pgvector/pgvector:pg17 | 5432 (internal only) | PostgreSQL + pgvector |
| backend | ./backend | 8001 | FastAPI (uvicorn) — started with `--ws-ping-interval 30 --ws-ping-timeout 300 --timeout-keep-alive 300` so long TTS turns aren't dropped |
| frontend | ./frontend | 3000 | React app served by nginx |

The frontend nginx container also reverse-proxies `/api/` → `backend:8001` (including the `/api/chat/ws` and `/api/sessions/ws` WebSocket upgrades) on the Docker internal network.

### Option B — Local development (no Docker)

**Backend:**
```bash
cd backend
py -3.11 -m venv venv
./venv/Scripts/activate
pip install -r requirements.txt
# Requires a running PostgreSQL with pgvector on localhost:5432
python -m app.setup      # create tables + run migrations
python -m app.seed       # seed default users (first run only)
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev              # starts Vite dev server on http://localhost:5173
```

> In dev mode the frontend hits `http://localhost:8001` directly. Set `VITE_API_URL` in `frontend/.env` if the backend runs on a different address.

---

## Production Deployment

Live at **https://dev.smartaitutor.online**

Architecture:
```
Browser → host Nginx (443/80, Certbot SSL)
            ├── /          → localhost:3000  (frontend Docker container)
            ├── /api/      → localhost:8001  (backend Docker container)
            └── /api/.../ws → localhost:8001  (WebSocket upgrade — chat + session pipelines)
```

The host Nginx `/api/` block must allow WebSocket upgrades (`proxy_set_header Upgrade`/`Connection`) and use a long `proxy_read_timeout` so long TTS turns aren't dropped.

Deployment steps on VPS:
```bash
cd /path/to/directory
git pull || git clone <repo-url>
docker compose build --no-cache frontend backend
docker compose up -d
```

---

## Chat Feature Split (Free vs Paid)

Two **separate pipelines** that share the low-level plumbing (WS transport, segment streaming, Kokoro TTS, mic VAD) but have their own turn logic, system prompt, tool set, and LLM — think Haiku vs Opus.

| | Simple Chat `/chat` (`/api/chat/ws`) | AI Session — paid (`/api/sessions/ws`) |
|---|--------------------|--------------------|
| LLM | `get_chat_llm()` (`GEMINI_CHAT_MODEL`) | `get_llm()` (`GEMINI_SESSION_MODEL`, premium) |
| System prompt | `SIMPLE_CHAT_SYSTEM_PROMPT` + student prefs | full personalised session prompt + lesson plan |
| Tools | `chat_tools` — web search + deep research only | `session_tools` — quiz, homework, mastery, lesson-phase, evaluate, report, web/deep search |
| RAG curriculum answers | ✅ | ✅ |
| Lesson logic / quiz / homework | ❌ | ✅ |
| Text mode | reply text only (**no TTS**) | TTS optional (Read-aloud toggle) |
| Voice mode | STT → reply → TTS | STT → reply → TTS |
| XP / credits | ✅ | ✅ |

Both run as backend-orchestrated WebSocket turns (`chat_service.run_chat_ws` / `session_agent_service.run_session_ws`). For the simple chat, the backend forces text turns to skip TTS and voice turns to use it (by message type). Tool context for `/chat` carries no `appointment_id`.

---

## Role-Based Routes

| Role | Landing page after login | Dashboard route |
|------|--------------------------|-----------------|
| Student | /dashboard | /dashboard |
| Teacher | /teacher/dashboard | /teacher/dashboard |
| Parent | /parent/dashboard | /parent/dashboard |
| Admin | /admin/dashboard | /admin/dashboard |

---

## Default Logins

| Role | Email | Password |
|---------|--------------------------|-------------|
| Admin | admin@smartai.com | admin123 |
| Teacher | teacher@smartai.com | teacher123 |
| Student | student@smartai.com | student123 |
| Parent | parent@smartai.com | parent123 |

---

## Development Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend — Vite dev | 5173 | http://localhost:5173 |
| Frontend — Docker nginx | 3000 | http://localhost:3000 |
| Backend (FastAPI/uvicorn) | 8001 | http://localhost:8001 |
| PostgreSQL | 5432 | localhost:5432 |
| API Docs (Swagger) | 8001 | http://localhost:8001/docs |

---

## Recent Changes (2026-06-05)

### Gemini Live removed → custom voice-to-voice on the same socket (Phase 4 done)
The real-time Gemini Live path (`/api/voice/ws`, `voice_agent_service` live-config/seed/tool-call/per-turn-RAG functions) was **deleted**. Voice now runs through the existing chat/session WebSocket: `useVoiceCapture` records the utterance with client-side RMS silence-VAD → sends `user_audio` → backend transcribes (Gemini STT) → runs the identical turn pipeline → replies as segment audio. `useVoice` is now a single-shot "Read aloud" hook only.

### Simple `/chat` migrated to its own WebSocket pipeline
`/api/chat/ws` (`chat_service.run_chat_ws`) replaces the old SSE chat. Text turns reply text-only (no TTS); voice turns do STT→TTS. The dead SSE routes (`/api/chat/stream`, `/api/chat/quiz-feedback`), `chatApi.streamMessage`/`streamQuizFeedback`, and `useChat`'s streaming half were removed; `useChat` is now just dashboard list/credits.

### Two-LLM split + `chat_tools`
`llm_service` exposes `get_llm()` (premium session, `GEMINI_SESSION_MODEL`) and `get_chat_llm()` (free chat, `GEMINI_CHAT_MODEL`). New `app/tools/chat_tools.py` binds a small subset (web search + deep research) to the chat LLM; `gemini_service.stream_response_async` picks the tool set + model via a `tool_set` arg.

### Service consolidation + Presenton/slides removal
`embedding_service`+`retrieval_service` → `rag_service`; `voice_service` → `voice_agent_service`; `credit`/`email`/`gamification`/`settings`/`scraper` → `platform_service`; `filler_service` → `session_agent_service`; `lesson_structure_service` → `lesson_service`. The Presenton slide generator, `slides_service`, the slides router, and the `session_slide` model were removed (the Learn tab now shows a "slides will appear here" placeholder).

### Neutral-bridge fillers
The situational filler classifier (`pick_filler`) and its 7 categories were removed. Only the `neutral` bucket remains (`get_neutral_filler()`) — the model's first sentence carries the real reaction. Re-run `python -m app.seed_voice_fillers --force` if the catalog changed.

---

## Recent Changes (2026-06-03)

> *Note: file names below reflect that date. They were later consolidated — `session_ws.py`/`segment_service.py` logic now lives in `routers/sessions.py` + `session_agent_service.py`; `filler_service.py` merged into `session_agent_service.py`. See Recent Changes 2026-06-05.*

### Solid session chat + TTS pipeline — unified WebSocket (Phase 1)
The old session chat raced three uncoordinated channels (SSE text + N `/voice/speak` HTTP calls + filler audio) with a fixed-60 ms reveal and optimistic message ids; it drifted, duplicated openings, and **froze after ~8–9 messages** (stuck ■ STOP, re-send pileup). Rebuilt as one backend-orchestrated WebSocket.

- **`backend/app/routers/session_ws.py`** (new) — `/api/session/ws`. Per turn: saves the user message once, streams the reply, and emits ordered `segment` events (one sentence + its bundled Kokoro audio + duration). Tool calls → structured `tool` events; finishes with `turn_end {message_id, full_text}` (authoritative DB id). A per-turn `asyncio.wait_for` timeout guarantees the socket can never hang. Also accepts `quiz_result` (quiz feedback rides the same pipeline) and `user_audio` (scaffolding for the future custom voice loop — **not wired up yet**).
- **`backend/app/services/segment_service.py`** (new) — streaming `SentenceSegmenter` + `build_segment()` (Kokoro TTS per sentence, bounded by a semaphore, duration measured via soundfile).
- **`backend/app/services/chat_service.py`** — added reusable `get_or_create_session_chat()`.
- **`frontend/src/hooks/useSessionChannel.ts`** (new) — WS client + ordered segment player that reveals each sentence's words over its audio's exact duration (true lockstep; WPM fallback when muted). Commits messages only on `turn_end` via server id → no duplicates/leaks. Lifecycle: open on active, close on pause, reopen on resume, close on end; heartbeat + reconnect-with-backoff + client watchdog (freeze recovery). One in-flight turn (input disabled) kills the re-send pileup.
- **`SessionPage.tsx` / `ChatWindow.tsx`** — swapped the `useChat` SSE + `useVoice` stream-TTS + filler tangle for `useSessionChannel`; ChatWindow renders committed messages + one live turn (`liveText`/`liveStatus`). Quiz question/score read-aloud now uses single-shot `speakText`.
- **`frontend/nginx.conf`** — added a `/api/session/ws` WS-upgrade block. **Production host Nginx needs the same block added manually.**
- Gemini Live voice mode was left untouched at this point — *(superseded: Phase 4 is now done, Gemini Live removed — see Recent Changes 2026-06-05).*

### Phase 2 — smart fillers
The pre-recorded clips are now a **neutral bridge** (new `neutral` bucket in `seed_voice_fillers.py`: "Okay.", "Right.", "Let me see."). The backend sends one neutral `filler` (text + audio) at turn start; the **model's own first sentence** carries the real contextual reaction (praise/correction/"let's dive in"). No more "Good question" misfires. `filler_service.get_neutral_filler()` + the hook's `playFiller` (clears the instant the first real segment plays). **Re-run the seeder** to generate the neutral clips: `docker compose exec backend python -m app.seed_voice_fillers --force` (degrades to no filler until then).

### Phase 3 — images & files
- **Input box:** 100×100 image thumbnail preview before send (chip for non-image files) — `ChatInput.tsx`.
- **Chat bubble:** the image/file renders above the message text — `ChatWindow.tsx` (`ChatMessage` gained optional `imageUrl`/`fileName`).
- **Backend:** images → Gemini vision (already); attached **PDF/DOCX/PPTX → text extracted** (`document_service.extract_text` via a temp file) and injected into the prompt so the AI can answer about the file — `session_ws.py:_extract_doc_text`.

---

## Recent Changes (2026-06-02)

### Voice — Kokoro TTS replaces gTTS/Gemini TTS (voice_service.py, main.py)
- `text_to_speech()` now runs **Kokoro-82M** locally on CPU (`KPipeline(lang_code="a")`, voice `af_sky`, speed 1.05) → WAV bytes at 24 kHz. Free, no quota, ~280 ms inference. Same return signature as before (no callers changed).
- `_prep_tts_text()` strips markdown so the voice doesn't read symbols aloud.
- Pipeline **pre-warmed** in `main.py` lifespan (`asyncio.to_thread(_get_kokoro)`) so the first request isn't slow (~300 MB model).
- `speech_to_text()` / `voice_converse()` still use Gemini.
- CPU inference tuned via `OMP_NUM_THREADS` / `TORCH_NUM_THREADS` / `MKL_NUM_THREADS` / `OPENBLAS_NUM_THREADS` (set in `docker-compose.yml` backend `environment`).

### LangChain migration (gemini_service.py + new llm_service.py)
- New **`llm_service.py`**: `get_llm()` returns a `ChatGoogleGenerativeAI` singleton (`max_retries=5`, replaces hand-rolled backoff).
- `gemini_service.py` rewritten on LangChain: native async `astream()` (true non-blocking streaming), `.with_structured_output(MCQQuestionList)` for quiz generation (replaces fragile JSON-repair), LangChain message types for prompt building.

### Thinking-filler player (NEW) — making empty waits engaging
> *Superseded (2026-06-05): the situational classifier and the `/fillers/*` routes were removed; only a single neutral-bridge bucket remains. Historical detail below.*
- **`app/seed_voice_fillers.py`** (seeder, run once): pre-generates 28 short tutor "filler" phrases with the **same `af_sky` voice** into `uploads/voices/<slug>.wav` + `manifest.json`, grouped by situation (`acknowledge`, `thinking`, `checking`, `encourage`, `praise`, `gentle_correct`, `transition`). Idempotent (`--force`, `--list`). Run: `python -m app.seed_voice_fillers`. Heavy deps are lazy-imported so `--list` works without Kokoro.
- **`services/filler_service.py`** + voice routes `GET /fillers/manifest`, `GET /fillers/audio/{slug}`, `POST /fillers/pick`. `pick_filler()` runs a fast Gemini Flash structured-output call to choose the best **waiting** bucket for the just-sent message (the model's reasoning is used only to pick — never shown to the student). LLM call offloaded via `asyncio.to_thread`.
- **Frontend** (`SessionPage.tsx` + `ChatWindow.tsx`): on session start, pre-caches every clip as an object URL. On send, fires `pickFiller` **in parallel** with the real chat stream (never delays the answer), shows a distinctive italic **filler bubble** (gradient pill + animated equaliser — clearly not the real answer) and plays the clip; loops a 2nd filler if the wait runs long. When the real response's TTS starts (`playing`), `stopFiller()` halts the clip and word-by-word reveal begins; when TTS ends the message commits to `messages`. A generation token guards rapid re-sends; muted = no filler. Design choice: **smart pre-classifier only** (Gemini reasoning isn't parseable mid-stream).

### TTS-synchronised word-by-word streaming (SessionPage.tsx + ChatWindow.tsx)
- Single `aiWaiting` flag drives a pulsing blue blob while waiting; when the real TTS starts (`playing`), the message reveals word-by-word in sync with the audio — the full text never flashes before the reveal.
- `localStreamRef` accumulates tokens; `lastKnownAiId` hides **only** the new message during reveal so earlier messages never disappear on a new send.
- `cancelStreamTTS()` resets the stuck `ttsProcessingRef` guard — fixes TTS/stream getting blocked after several continuous messages.

### End-lesson confirmation modal (SessionPage.tsx)
- "End Lesson" now opens a styled confirmation dialog (red warning icon, "End this lesson?", **Keep Learning** / **End Lesson**) — not a browser `confirm`. Shows "Ending…" and disables while the terminate request runs; backdrop blur + spring pop-in.

### Session report 400 fix (appointments.py + PostSessionScreen.tsx)
- The report endpoint returns `{ "pending": true }` (200) instead of HTTP 400 while a just-ended session is still finalising; the frontend retries on `pending` with backoff. Eliminates the `GET /api/appointments/:id/report 400` spam.

### Production
- Deployed via Docker on a new VPS; **host Nginx + Certbot SSL** serve `dev.smartaitutor.online` (and `www.`). Host Nginx reverse-proxies `/` → frontend:3000, `/api` & `/ws` → backend:8001, `/slides` → presenton:5000.

---

## Recent Changes (2026-05-20)

### Sidebar (Sidebar.tsx)
- **Singleton dropdown** — replaced separate `chatsExpanded`/`sessionsExpanded` booleans with a single `openDropdown: string | null` state
- `toggleDropdown(id)` closes the current open dropdown and opens the new one; clicking the same one toggles it off
- All dropdowns **closed by default** (null) — no auto-open on page load
- Full sidebar content preserved: Chats dropdown + Sessions dropdown + Learning Time widget for student; Sessions dropdown for teacher + parent

### Session Flow (SessionPage.tsx)
- **No briefing screen** — session auto-joins immediately if no passcode required
- **Auto-start** — after join, if 0 messages, sends human-readable lesson start message after 800ms: `"Let's start our lesson on {topic}! I'm ready to begin."`
- Empty state replaced with "Starting your lesson…" loading indicator (no "Ask me anything" prompt)
- Passcode-only screen simplified (removed AI briefing right panel)

### Session AI Architecture (session_agent_service.py)
- When `LessonPlan.plan_blocks` is present, AI follows the goal-specific step plan generated at booking time; generic CONNECT→TEACH→PRACTICE→APPLY→REFLECT structure is only used as fallback when no plan_blocks exist
- AI always leads; never waits for the student to initiate; step transitions happen on task completion

### `__LESSON_START__` Intercept (chat.py)
- Backend detects `message.content == "__LESSON_START__"`, skips DB save, substitutes lesson-start instruction to Gemini
- Frontend sends human-readable text instead of the raw trigger

### Dashboard (DashboardPage.tsx + WelcomeScreen.tsx)
- Hero banner stats redesigned to pill badges (🔥 Streak, ⭐ XP, Level + progress bar)
- Kept 4 QUICK_ACTIONS cards (Start a Lesson, My Progress, My Sessions, Assignments)
- Added "Pick a Subject & Tutor" section — 3 subject cards linking to `/lesson/setup` with pre-filled subject state
- All subject/lesson links → `/lesson/setup` (never `/chat`)

### TTS Mute Fix (SessionPage.tsx)
> *Superseded (2026-06-05): client-side streaming TTS (`feedStreamTTS`/`cancelStreamTTS`) was removed; TTS is now server-side per-sentence segments and muting is handled by `useSessionChannel` (it skips/pauses segment audio when `ttsEnabled` is false). Historical detail below.*
- `ttsEnabledRef = useRef(true)` + sync effect; all callbacks read `ttsEnabledRef.current` (not stale `ttsEnabled` state)
- `cancelStreamTTS` destructured from `useVoice` and called **immediately** when mute is toggled off — stops any active in-flight TTS stream
- All `onToken` callbacks gated: `if (!ttsEnabledRef.current) return;` before `feedStreamTTS(t)`
- Fixes mute button having no effect mid-stream and stale closure bug

### Goal-Specific Lesson Plan (session_agent_service.py + lesson_structure_service.py)
- At booking time, `lesson_structure_service.auto_create_lesson_plan()` generates `LessonPlan.plan_blocks` — time-boxed steps matched to the chosen goal (Homework Help, Learn from Scratch, Catch Up, Revision) and learn mode (AI Recommended, Slides, Worksheet, Quiz)
- `build_session_system_prompt()` now detects `has_plan_blocks`; when true, the goal-specific plan **fully replaces** the generic 5-phase structure and `lesson_plan_str` — eliminating the three competing structures that caused AI confusion
- Plan block header rendered with box-drawing characters for emphasis: `YOUR LESSON PLAN (set at booking)` + `ACTIVE STEP: Step N of N` + `TIME REMAINING: ~M minutes`

### TEACH vs PRACTICE Step Type Rule (session_agent_service.py)
- `STEP TYPE RULE` added to TEACHING STYLE section: during `recap` or `teach` steps — **pure teaching only, no check questions**; during `practice` steps — **ask ONE focused question per response and wait**
- Prevents AI from asking questions during explanation steps (root cause of premature comprehension checks)
- `_STEP_META` in `lesson_structure_service.py` updated: teach-type entries explicitly say "TEACH ONLY — do NOT ask questions"; practice entries specify "Give 1 question, wait for attempt, give feedback, move on"

### Session Never-Ends-Early Rule (session_agent_service.py)
- `CRITICAL SESSION RULES` block added to plan_blocks section: AI must **never** say "See you next time", "goodbye", "that's all for today", or any phrase implying the session is over
- After completing Review/Summary, AI **immediately continues** — moves to next topic or deepens practice
- All topics in the TOPICS list must be taught before any final summary
- Session ends **only** when the student says they want to stop or clicks the End Lesson button
- `Review & Next Steps` and `Summary` step instructions in `_STEP_META` updated with explicit "Do NOT say goodbye" language

### No Apology Language (session_agent_service.py)
- `NEVER apologise` added to the ALWAYS block and QUIZ RULES
- Expanded banned vague check-ins: removed "shall we move on?", "ready to continue?", "shall we get started?", "any questions so far?"

### Quiz Topic Specificity Fix (session_agent_service.py + gemini_service.py)
- `QUIZ_OFFER` topic must now be the **specific concepts taught** in the session (e.g. `"eukaryotic vs prokaryotic cells, light microscope magnification"`) — not generic booking unit names (e.g. `"Cell-structure-1"`)
- `generate_mcq_questions()` in `gemini_service.py` strengthened with `STRICT TOPIC SCOPE` constraint in both the prompt and system instruction: "Do NOT write questions about other topics even if they appear in curriculum material"
- Two-layer fix ensures quiz questions stay scoped to what was actually taught, not the full KB unit

### BookSessionPage.tsx — full page redesign
- Gradient hero banner; numbered step cards (1–4); 5-column compact Session Goal cards
- Right sidebar: live lesson plan preview + Session Summary + availability bar
- Sticky "Confirm & Book Session →" bottom bar

### ChatPage.tsx
- Added "Start a structured lesson →" button above subject pills → `/lesson/setup`

### PostSessionScreen.tsx
- Fixed routes: "Back to Dashboard" → `/dashboard`, "Ask AI Tutor" → `/chat`; added "Start New Lesson" → `/lesson/setup`

### Navigation Rule
- Student dashboard is `/dashboard` (not `/student/dashboard`)
- All structured learning links → `/lesson/setup` (not `/chat`)

---

## Features Not Yet Implemented (Soon)

- Teacher: Assignments creation UI, Class Progress analytics
- Student: Subjects browser page, Messages page
- Parent: Progress Tracker page, Messages page
- AI Avatar video (placeholder shown in session)
- Real email sending (currently logs dummy emails)
- Payment processing for subscriptions
- Google Drive slides integration (planned — needs folder structure + API key)
