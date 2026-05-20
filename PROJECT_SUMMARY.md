# SmartAI Tutor — Project Summary

> **Last updated:** 2026-05-20
> **Recent changes:** Dashboard redesign · LessonSetupPage UI overhaul · BookSessionPage full redesign · TTS stale closure fix · `/dashboard` redirect alias added

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
Gemini 2.5 Flash generates curriculum-grounded response (with tool calls for quiz/slides)
    |
    v
Streamed to student (text via SSE, voice via Gemini Live API)
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
| Models | `user.py`, `chat.py`, `documents.py`, `subscription.py`, `appointment.py`, `lesson_plan.py`, `assessment.py`, `assignment.py`, `student_profile.py`, `session_slide.py`, `parent_student.py` | ORM models for all entities |
| Schemas | `user.py`, `chat.py`, `documents.py`, `subscription.py`, `appointment.py`, `lesson.py`, `assessment.py`, `gamification.py`, `settings.py`, `assignment.py` | Pydantic request/response validation |
| Services | `gemini_service.py`, `embedding_service.py`, `retrieval_service.py`, `document_service.py`, `chat_service.py`, `voice_service.py`, `voice_agent_service.py`, `credit_service.py`, `user_service.py`, `appointment_service.py`, `session_agent_service.py`, `lesson_service.py`, `assessment_service.py`, `assignment_service.py`, `gamification_service.py`, `email_service.py`, `scraper_service.py`, `slides_service.py`, `settings_service.py` | Business logic |
| Routers | `auth.py`, `chat.py`, `voice.py`, `documents.py`, `admin.py`, `teacher.py`, `parent.py`, `appointments.py`, `sessions.py`, `lessons.py`, `assessments.py`, `assignments.py`, `gamification.py`, `settings.py`, `slides.py`, `subscription.py`, `health.py` | REST, SSE, WebSocket endpoints |
| Middleware | `auth.py`, `rate_limit.py` | JWT guard, role-based access, rate limiting |
| Scripts | `setup.py`, `seed.py` | Database setup and seed data |

### Key Backend Features

- **Multi-role system**: Admin, Teacher, Student, Parent with role-based access control (JWT + bcrypt)
- **RAG pipeline**: pgvector HNSW index (M=16, ef=64, cosine ops), Gemini text-embedding-001 (768d), top-5 chunks with min 0.3 similarity
- **Document processing**: PDF (pypdf), DOCX (python-docx), PPTX (python-pptx) extraction; 500-token chunks with 50-token overlap; batch embedding; status tracking (pending → ready/failed)
- **Chat**: Gemini 2.5 Flash streaming (SSE + WebSocket), auto-generated titles, 20-message context window + RAG context injection, per-message credit deduction
- **Voice**: Gemini Live API for real-time bidirectional audio (native STT + TTS), continuous conversation with auto VAD; gTTS fallback for TTS
- **Session/Appointment system**: Teacher or parent books sessions; status flow (booked → confirmed → in_progress → completed/cancelled/terminated/paused); session passcode support
- **Session slides**: AI-generated lesson slides (JSONB: title, subtitle, key_points, key_terms) created during session chat via slides_service; served to frontend in real-time
- **Quiz/Assessment system**: Gemini tool call generates quiz questions during sessions; answer evaluation; scoring (score_percent, correct_answers); strong/weak topic analysis
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
| Hooks | `useChat.ts`, `useVoice.ts` | Chat SSE streaming, Gemini Live WebSocket |
| Services | `api.ts` | API client for all 17 backend router groups |
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
- **Real-time voice mode**: Mic button opens Gemini Live API WebSocket; continuous PCM audio streaming; auto VAD; live transcripts in chat bubbles with "Listen" button; AI audio playback
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
| POST | /api/chat/stream | Send message (SSE stream) |
| DELETE | /api/chat/:sessionId | Delete a chat |
| POST | /api/chat/for-appointment/:id | Get/create session chat |
| WS | /api/chat/ws | WebSocket chat |

### Voice
| Method | Endpoint | Description |
|--------|---------------------------|------------------------------|
| POST | /api/voice/speak | Text-to-speech (gTTS) |
| WS | /api/voice/ws | Real-time voice (Gemini Live) |

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

### Sessions (Quiz within appointments)
| Method | Endpoint | Description |
|--------|-----------------------------------------------|--------------------------|
| POST | /api/sessions/:appointmentId/quiz/start | Start quiz |
| GET | /api/sessions/:appointmentId/quiz/latest | Get latest attempt |
| POST | /api/sessions/:appointmentId/quiz/:id/answer | Submit answer |
| POST | /api/sessions/:appointmentId/finish | Complete session + report |

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

### Slides
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/slides/session/:sessionId | Get slides for session |
| POST | /api/slides/generate | Generate new slide |
| PATCH | /api/slides/:id | Update slide |

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
| AI Model | Google Gemini 2.5 Flash |
| Embeddings | Gemini text-embedding-001 (768d with output_dimensionality) |
| Voice (Live) | Gemini Live API (native bidirectional audio, WebSocket) |
| TTS (fallback) | gTTS (Google Text-to-Speech) |
| Vector Index | pgvector HNSW (M=16, ef=64, cosine similarity) |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Document parsing | pypdf, python-docx, python-pptx |
| Web scraping | BeautifulSoup4 |
| Email | Dummy SMTP (dev), HTML templates via email_service.py |
| Slide generation | Presenton (self-hosted, Docker image `ghcr.io/presenton/presenton:latest`) |
| Containerisation | Docker + Docker Compose (4 services: db, presenton, backend, frontend) |
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
| presenton | ghcr.io/presenton/presenton:latest | 5000 | AI slide generator |
| backend | ./backend | 8001 | FastAPI (uvicorn) |
| frontend | ./frontend | 3000 | React app served by nginx |

The frontend nginx container also reverse-proxies `/api/` → `backend:8001` and `/ws/` on the Docker internal network.

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
            ├── /api/      → localhost:8001  (backend Docker container, proxy_buffering off for SSE)
            ├── /ws/       → localhost:8001  (WebSocket upgrade)
            └── /slides/   → localhost:5000  (Presenton Docker container)
```

Deployment steps on VPS:
```bash
cd /path/to/directory
git pull || git clone <repo-url>
docker compose build --no-cache frontend backend
docker compose up -d
```

`PRESENTON_PUBLIC_URL` in `docker-compose.yml` is set to `https://dev.smartaitutor.online/slides` so slide iframe URLs resolve correctly in the browser.

---

## Chat Feature Split (Free vs Paid)

| Feature | Simple Chat `/chat` | AI Session (paid) |
|---------|--------------------|--------------------|
| RAG curriculum answers | ✅ | ✅ |
| Quiz generation | ❌ | ✅ |
| Slide generation | ❌ | ✅ |
| Voice mode | ✅ | ✅ |
| XP / gamification | ✅ | ✅ |

Simple chat uses `SIMPLE_CHAT_SYSTEM_PROMPT` (no `[QUIZ_OFFER]` / `[SLIDE_TRIGGER]` instructions). Session chat uses the full personalised system prompt. The distinction is made in `backend/app/routers/chat.py` via the `is_session` flag (derived from the `appointment_id` FK on the chat).

---

## Role-Based Routes

| Role | Landing page after login | Dashboard route |
|------|--------------------------|-----------------|
| Student | /student/dashboard | /student/dashboard (alias /dashboard redirects here) |
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
| Presenton | 5000 | http://localhost:5000 |
| API Docs (Swagger) | 8001 | http://localhost:8001/docs |

---

## Recent UI Changes (2026-05-20)

### Dashboard (DashboardPage.tsx + WelcomeScreen.tsx)
- Hero banner stats redesigned from card boxes to pill badges (🔥 X Day Streak, ⭐ XP, Level N + progress bar) matching LessonSetupPage style
- Kept top 4 QUICK_ACTIONS cards (Start a Lesson, My Progress, My Sessions, Assignments)
- Removed: 4 stat boxes below QUICK_ACTIONS, Today's Study Plan section, Quick Actions grid, AI Tip card, bottom navigation links row
- Added "Pick a Subject & Tutor" section with 3 subject cards (Maths, Science, English) — all link to `/lesson/setup` with pre-populated subject state
- All subject/lesson links navigate to `/lesson/setup` (never `/chat` for structured content)
- "Continue Learning" button navigates to active session or `/lesson/setup`

### TTS Stale Closure Fix (SessionPage.tsx)
- Added `ttsEnabledRef = useRef(true)` + `useEffect(() => { ttsEnabledRef.current = ttsEnabled }, [ttsEnabled])`
- All 4 callback closures now read `ttsEnabledRef.current` instead of the stale `ttsEnabled`
- Fixes mute button having no effect — TTS API calls were firing regardless of toggle state

### LessonSetupPage.tsx — Step UI overhaul
- Goal cards (Step 2): replaced full-width vertical list with **4-column compact horizontal grid** — radio circle (top-left), colored icon, label, description
- Learn mode (Step 4): replaced wide flex cards with **4-column compact grid** with radio circles and "Recommended" badge
- Removed: Step 5 file upload section, "+ Add more details" accordion, passcode checkbox — cleaner 4-step flow

### BookSessionPage.tsx — full page redesign
- Replaced plain page header with gradient hero banner (same style as LessonSetupPage)
- All 4 form sections wrapped in numbered step cards (Step 1–4)
- Session Goal selector changed from dropdown to **5-column compact cards** with icons (Sprout, BookOpen, RefreshCw, GraduationCap, Sparkles)
- Right sidebar redesigned: "Session Preview" with live lesson plan step pills (green/blue/yellow/purple) + Session Summary + What Happens Next + Availability progress bar
- Submit button moved to sticky bottom bar: "Confirm & Book Session →" with status summary pills

### ChatPage.tsx
- Added "Start a structured lesson →" button above subject pills (navigates to `/lesson/setup`)
- Updated heading subtext to "Quick questions, homework help, or explore a topic."

### PostSessionScreen.tsx
- Fixed broken routes: "Back to Dashboard" → `/dashboard`, "Ask AI Tutor" → `/chat`
- Added "Start New Lesson" button → `/lesson/setup`

### App.tsx
- Added `/dashboard` as a `<Navigate>` alias that redirects to `/student/dashboard`

---

## Features Not Yet Implemented (Soon)

- Teacher: Assignments creation UI, Class Progress analytics
- Student: Subjects browser page, Messages page
- Parent: Progress Tracker page, Messages page
- AI Avatar video (placeholder shown in session)
- Real email sending (currently logs dummy emails)
- Payment processing for subscriptions
- Google Drive slides integration (planned — needs folder structure + API key)
