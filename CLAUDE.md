# SmartAI Tutor — Claude Code Context

## What This System Is

SmartAI Tutor is a commercial AI-powered tutoring platform for UK GCSE students (Key Stages 1–5). It delivers structured AI lessons using Google Gemini, a RAG knowledge base built on pgvector, and real-time voice via a custom **STT → turn → Kokoro-TTS** pipeline over WebSocket (the old Gemini Live path has been removed). The platform is deployed at **dev.smartaitutor.online**.

Curriculum + teaching content now come from an external **Resource Hub** (see the integration plan at the bottom of this file), not the legacy admin-uploaded knowledge base.

---

## Stack & Ports

| Layer | Tech | Port |
|-------|------|------|
| Frontend | React 18 + TypeScript + Vite | 5173 (dev) / 3000 (Docker) |
| Backend | FastAPI (Python 3.11) | 8001 |
| Database | PostgreSQL 17 + pgvector 0.8.2 | 5432 |
| AI — text | Google Gemini (LangChain, streamed over WebSocket) | — |
| AI — voice | Custom STT (Gemini) → Kokoro TTS, over the chat/session WebSocket | — |
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
  models/         — SQLAlchemy models (users, chats, documents, appointments, assignments, resource_hub)
  routers/        — API endpoints (auth, chat, voice, admin, teacher, appointments, documents, curriculum)
  schemas/        — Pydantic request/response models
  services/
    chat_service.py           — Chat CRUD + RAG context building
    gemini_service.py         — Gemini streaming + RAG injection
    rag_service.py            — Gemini embeddings + pgvector cosine retrieval
    session_agent_service.py  — Session AI (goal-specific lesson structure)
    document_service.py       — PDF/DOCX/PPTX extraction + chunking
    voice_agent_service.py    — STT + Kokoro TTS
    resource_hub_client.py    — Async client for the external Resource Hub API
    resource_sync_service.py  — Jobs: mirror curriculum + vectorize resources
    curriculum_service.py     — Read API over the rh_* mirror
    credit_service.py         — Credit deduction + subscriptions
    user_service.py           — User CRUD

frontend/src/
  components/     — Sidebar, WelcomeScreen, ChatWindow, ChatInput, ResourceViewer, LottiePlayer, etc.
  context/        — AuthContext (JWT state)
  hooks/          — useSessionChannel (chat/session WS pipeline), useVoiceCapture (mic VAD → user_audio), useVoice (single-shot "Read aloud" TTS), useChat (dashboard list/credits)
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
/session/{id} → SessionPage → AI delivers goal-specific lesson
```

- `SessionPage.tsx` auto-joins if appointment has no passcode (no briefing screen)
- After join, if session is fresh (0 messages), auto-sends a human-readable start message after 800ms
- The start message format: `"Let's start our lesson on {topicText}! I'm ready to begin."`

### Goal-Specific Lesson Plan (backend-enforced)
At booking time, `appointments.py` calls `lesson_service.auto_create_lesson_plan()` which creates a `LessonPlan` record with `plan_blocks` — time-boxed steps specific to the chosen **goal** (learn_scratch, homework, catch_up, revision) × **duration** (20/40/60/90 min).

`build_session_system_prompt()` in `session_agent_service.py` reads these plan_blocks and:
- **When plan_blocks exist**: injects the goal-specific steps ONLY — suppresses the generic `lesson_plan_str` and MANDATORY 5-phase block entirely
- **When plan_blocks absent**: falls back to the generic 5-phase duration-based structure

Each step has a `type` (recap / teach / practice / quiz / review) and an `ai_instruction`.

**Step type rules (enforced in system prompt):**
- `recap` / `teach` steps: PURE TEACHING — AI never asks check questions
- `practice` steps: AI asks ONE focused question per response, waits for answer
- `review` steps: brief recap then IMMEDIATELY continues to next topic (no goodbye language)

**Session never ends via AI** — the student ends it with the "End Lesson" button. After Review/Summary, AI continues to the next topic or deeper practice.

### Generic Fallback — 5-Phase Structure
Used only when no plan_blocks exist:
1. **CONNECT** (10%) — warm opener, prior knowledge, goal-setting
2. **TEACH** (40%) — step-by-step explanations, examples
3. **PRACTICE** (25%) — guided questions, adaptive difficulty, instant feedback
4. **APPLY** (15%) — independent challenge, detailed feedback
5. **REFLECT** (10%) — recap, strengths, next steps

The AI always leads; it never waits for the student to initiate.

### `__LESSON_START__` Intercept (backend)
- `backend/app/routers/chat.py` detects `message.content == "__LESSON_START__"`
- Skips saving it to the DB (so it doesn't appear as a user message)
- Substitutes a structured lesson-start instruction to Gemini
- **Note:** The frontend now sends human-readable text instead of this raw trigger

### RAG (Resource Hub content)
- Teaching content comes from the Resource Hub, vectorized into `rh_document_chunks`
- Chunks embedded with `gemini-embedding-001`, stored in pgvector with HNSW index
- Top-5 chunks retrieved per query at cosine similarity ≥ 0.3 via `rag_service.retrieve_hub_chunks`
- Sessions filter tightly (unit/topic + goal resource types); simple chat filters loosely (subject/key_stage)
- The legacy `documents`/`document_chunks` KB + admin upload are dormant (decommission later)

### TTS Mute (useSessionChannel)
TTS is now generated **server-side** as per-sentence segments (`{type:"segment", audio_b64, duration_ms}`) bundled with each turn — there is no client-side streaming-TTS queue anymore.
- `ttsEnabled` is passed into `useSessionChannel`; `ttsEnabledRef` mirrors it so the player reads the live value.
- `playAudio()` skips a segment's audio when `!ttsEnabledRef.current`, and a sync effect pauses any in-flight clip the instant the user mutes — text still reveals at a word-per-minute cadence.
- The client sends `tts: ttsEnabledRef.current` on each message; for the simple `/chat` the backend overrides this by mode (text turn = no TTS, voice turn = TTS).

### Session Preview Screen (SessionPage.tsx)
Before joining, student sees a 2-column briefing screen:
- Left: gradient hero card (subject, key stage, topics, session type), lesson phase timeline, join/passcode card
- Right: AI Session Briefing panel (hook, what you'll learn, key ideas, key terms, session tip) — fetched via `appointmentsApi.getBriefing()`
State variables: `sessionBriefing`, `briefingLoading`

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

Curriculum dropdowns (Key Stage → Year Group → Subject → Unit → Topic) are sourced from `curriculumApi` (the Resource Hub mirror).

---

## Security Rules

**NEVER SSH into the production VPS (187.124.210.62) without explicit user confirmation.**
Always ask before running any `ssh`, `scp`, or remote command targeting that IP.

---

## Common Gotchas

1. **Docker container name conflict on rebuild** — run `docker compose down` first
2. **Agent writes not persisting** — if a sub-agent reports success but the file looks unchanged, use the Edit tool directly
3. **pgvector dimension mismatch** — Gemini embedding-001 produces 768d vectors; schema must match
4. **WS ping settings required** — voice WebSocket drops without `--ws-ping-timeout 300 --ws-ping-interval 30`
5. **Credits** prop on Sidebar is passed by parent but not rendered (learning time widget was removed)
6. **No migration tool** — schema is created by `Base.metadata.create_all` in `app/db/init_db.py`; new tables auto-create once their model is imported in `app/models/__init__.py`. Altering existing tables needs raw SQL in init.

---

## Resource Hub Integration — Plan

> **Status: APPROVED — implementing in phases.** Full plan: `~/.claude/plans/cryptic-orbiting-bentley.md`.

### What This Is
The external **Resource Hub** (`https://hub.resourcefullearning.co.uk`) is the single source of truth for the whole curriculum tree **and** all teaching files (slides, worksheets, mark schemes, homework, videos, links):

```
Key Stage → Year Group → Subject → Unit → Topic (optional) → Resource(s)
```

The app mirrors this into local `rh_*` tables via two scheduled jobs and reads curriculum + content from the mirror everywhere (lesson setup, sessions, simple chat, profile, dashboard). The legacy `documents` KB is unwired (dormant, removed later).

### Resource Hub API
Auth: `?api_key=<key>` **or** `Authorization: Bearer <key>` (key in `.env`, `RESOURCE_HUB_API_KEY`).
- `GET /api/v1/curriculum/keystages` → `{"data":["KS1".."KS5"]}`
- `GET /api/v1/curriculum/years?keyStage=KS2` → `{"data":["Year 3",...]}` (omit `keyStage` → grouped)
- `GET /api/v1/curriculum/subjects?keyStage=&yearGroup=` → `{"data":[{"id":9,"name":"Maths"}]}`
- `GET /api/v1/curriculum/units?subjectId=9` → `{"data":[{"id":65,"title":"UNIT 3: Shape","unitNumber":1}]}`
- `GET /api/v1/curriculum/topics?unitId=65` → `{"data":[{"id":278,"title":"1. Naming 2D shapes"}]}`
- `GET /api/v1/resources?keyStage=&yearGroup=&subjectId=&unitId=&topicId=&resourceType=&page=&limit=` → `{"data":[...],"total","page","limit","totalPages"}`

**Resource object:** `id`, `title`, `description`, `resourceType` (pdf|powerpoint|youtube|external_link|worksheet|…), `keyStage`, `yearGroup`, `subject` (name), `unitTitle`, `topicTitle`, `fileUrl`, `youtubeUrl`, `externalUrl`, `tags` (csv), `createdAt`. Resources link to curriculum **by name** (subject/unitTitle/topicTitle + keyStage + yearGroup), not by id.

### Data model — `backend/app/models/resource_hub.py` (`rh_*` tables)
`RHKeyStage`, `RHYearGroup`, `RHSubject`, `RHUnit`, `RHTopic`, `RHAvailability` ((KS,year)→subject/unit edges that power "different subjects per year group"), `RHResource` (metadata + `vectorize_status` + `raw_json`), and `RHDocument`/`RHDocumentChunk` (vector store; chunks carry `slide_index` for per-slide teaching, HNSW cosine index like `DocumentChunk`).

### Jobs + scheduler
- **Job 1 `sync_curriculum()`** — mirror keystages→years→subjects→units→topics; idempotent upsert by `hub_id`; prune deletions.
- **Job 2 `sync_resources()`** — page `/resources`, upsert `RHResource`, resolve curriculum links by name; for file types with `fileUrl` (pdf/powerpoint/worksheet/docx/mark-scheme) → download → per-page/slide extract → chunk → `embed_batch` → `RHDocumentChunk`. youtube/external_link = metadata only (`skipped`).
- APScheduler `AsyncIOScheduler` started in `main.py` lifespan; runs once on startup + on intervals (`curriculum_sync_hours`=12, `resource_sync_hours`=6). Admin manual trigger: `POST /api/curriculum/sync`.

### Read API + retrieval
- `routers/curriculum.py` + `curriculum_service.py`: GET keystages/years/subjects/units/topics/resources over the mirror. `lessons.py` curriculum endpoints + `lesson_service.get_topics_for_subject/get_subtopics` repointed to `rh_*`.
- `rag_service.retrieve_hub_chunks(...)` searches `RHDocumentChunk ⋈ RHDocument ⋈ RHResource`, filterable by curriculum + resource type. Sessions filter tight; simple chat filters loose.

### Session slide-teaching
- Session start builds a **resource playlist** from the lesson's KS/year/subject/unit, filtered by goal→type map: homework→worksheets/homework; catch_up→slides/homework/worksheets; exam_prep→mark scheme/slides/links; learn_scratch→slides (others on request).
- New `@tool`s in `session_tools.py`: `advance_lesson_slide()` / `retreat_lesson_slide()` / `show_resource(resource_hub_id)`. They update `LessonPlan.session_state` (`current_resource_id`, `current_slide_index`) and emit a WS `{type:"tool", tool:"show_resource", data:{...}}`. AI teaches the **current slide's content** (injected from `RHDocumentChunk` for that `slide_index`), advances on a correct answer, retreats when the student struggles.
- Frontend `components/ResourceViewer.tsx` iframe renders the current resource (PDF via `fileUrl#page=N`, PPTX/DOC via Office/Google embed, youtube/links inline), driven by `show_resource` events from `useSessionChannel`.

### Phases
1. Schema + config/env + `resource_hub_client.py`
2. Job 1 + scheduler + curriculum read API; repoint `lessons.py`/`lesson_service`
3. Frontend curriculum swap (LessonSetupPage year-group, profile/dashboard subjects)
4. Job 2 + per-slide vectorize + `retrieve_hub_chunks`; repoint session + simple-chat RAG
5. Session slide viewer + advance/retreat/show_resource tools
6. (later) remove dormant admin KB

### Config / env (new)
`RESOURCE_HUB_BASE_URL`, `RESOURCE_HUB_API_KEY`, `CURRICULUM_SYNC_HOURS`, `RESOURCE_SYNC_HOURS`, `RESOURCE_SYNC_ENABLED` — added to `config.py`, `.env`, `.env.example`, `docker-compose.yml`. Dep added: `apscheduler` (httpx/pypdf/python-pptx already present).
