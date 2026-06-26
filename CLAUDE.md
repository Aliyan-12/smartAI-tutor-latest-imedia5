# SmartAI Tutor — Claude Code Context

## What This System Is

SmartAI Tutor is a commercial AI-powered tutoring platform for UK GCSE students (Key Stages 1–5). It delivers structured AI lessons using Google Gemini, a RAG knowledge base built on pgvector, and real-time voice via a custom **STT → turn → Kokoro-TTS** pipeline over WebSocket (the old Gemini Live path has been removed). The platform is deployed at **dev.smartaitutor.online**.

Curriculum + teaching content come from an external **Resource Hub** (mirrored into `rh_*` tables), not the legacy admin-uploaded knowledge base. Auth, multi-tenant schools, and interactive visual puzzles were added in the **Major Upgrade** (see the section at the bottom of this file).

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
| Auth | JWT + Google OAuth (Authlib) + email verification; Casbin RBAC | — |
| Puzzles | SVG + react-konva interactive visual puzzles | — |

Vector search: pgvector HNSW cosine, top-5 chunks, min 0.3 similarity.

---

## User Roles

| Role | Dashboard route | Notes |
|------|-----------------|-------|
| superadmin | `/school/dashboard` | Owns a single school tenant; manages its teachers/students/parents |
| admin | `/admin/dashboard` | Full platform control (cross-school) |
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
  core/           — Config, JWT + OAuth/verification security (security.py, tokens.py, casbin_model.conf)
  db/             — Database session, init
  middleware/     — Auth guards (require_role + Casbin require_permission), rate limiting
  models/         — SQLAlchemy models (users, school, auth_tokens, chats, appointments, assignments, resource_hub)
  routers/        — API endpoints (auth, school, chat, voice, admin, teacher, appointments, documents, curriculum)
  schemas/        — Pydantic request/response models
  services/
    chat_service.py           — Chat CRUD + RAG context building
    gemini_service.py         — Gemini streaming + RAG injection
    rag_service.py            — Gemini embeddings + pgvector cosine retrieval
    session_agent_service.py  — Session AI (goal-specific lesson structure, slides + puzzles)
    document_service.py       — PDF/DOCX/PPTX extraction + chunking
    voice_agent_service.py    — STT + Kokoro TTS
    resource_hub_client.py    — Async client for the external Resource Hub API
    resource_sync_service.py  — Jobs: mirror curriculum + vectorize resources
    curriculum_service.py     — Read API over the rh_* mirror
    casbin_service.py         — Casbin RBAC enforcer + policy seeding
    oauth_service.py          — Authlib Google OAuth registry
    school_service.py         — School (tenant) CRUD + default-school accessor
    puzzle_service.py + puzzle_templates.py — visual-puzzle registry/build/solve
    platform_service.py       — Credits, XP/streaks, email (verification/reset)
    user_service.py           — User CRUD

frontend/src/
  components/     — Sidebar, WelcomeScreen, ChatWindow, ChatInput, ResourceViewer, PuzzlePlayer, puzzles/*, LottiePlayer, etc.
  context/        — AuthContext (JWT + verification/onboarding state, Google sign-in)
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

### Event-Driven Session WebSocket (`run_session_ws` in `session_agent_service.py`)
The session WS is a typed **event** channel, not just chat. Inbound frames are validated by a Pydantic **discriminated union** (`schemas/session_events.py`, tagged on `type`, unknown → logged + ignored, never crashes). Every event is routed by an `EVENT_SPECS`-style registry into one of three **buckets** (all logged `EVENT in kind=… bucket=…`):
- **AI_REACTIVE** → runs an AI turn via `_run_turn` (`user_message`, `user_audio`, `puzzle_result`, `quiz_result`, `lesson_end_request`, `lesson_timeout`, `student_idle`). One in-flight turn; a result arriving mid-turn is queued (`_QUEUEABLE`) and drained on completion — never dropped.
- **SIDE_EFFECT** → quick state mutation, no LLM (`lesson_pause`/`lesson_resume` → `appointment_service.update_status`).
- **TELEMETRY** → `ping`/`stop` handled inline.

Outbound: existing `segment`/`tool`/`turn_end` plus a generic `{type:"event",kind,text}` (renders a centered **`role:"event"`** pill in `ChatWindow`) and `lesson_timeout` / `lesson_ended` notices. Frontend: `useSessionChannel.sendEvent(type,data,triggersReply)` + `onEnded`; any component emits via the **mitt bus** `lib/sessionBus.ts` → `SessionPage` forwards to the WS.

**Lifecycle (all logged):** `connected_at` stamped on accept → `WS lifetime=…` on close. A per-connection **watchdog** (`asyncio` task, ~20s tick, cancelled in `finally`) checks `_compute_lesson_clock` AND student-idle time. On close, if the appointment is still `started` it **auto-pauses** (flagged `auto_paused` so a reconnect auto-resumes; guarded by "still the active connection" so a replacing reconnect doesn't pause the new session).

**Idle detection (watchdog):** `last_activity` is reset on any real student event (message/audio/puzzle/quiz). After **`_IDLE_CHECK_S`=300s** (5 min) of silence → `student_idle` stage 1 (AI sends a short "still there?"). After **`_IDLE_PAUSE_S`=420s** (7 min) → stage 2 (AI announces it's pausing, then the server **reliably pauses** via `_handle_lesson_pause`, freezing the clock). When the student sends a message again, `_resume_if_paused` resumes it. Idle never accrues while paused or while the AI is mid-turn.

**End semantics:** AI may end **only** when `end_allowed` is set — i.e. after `lesson.timeout` or a student **End** click. On **time-up** the AI gives a short summary + goodbye and calls `end_lesson`; a **server fallback** (`_force_end_and_report`) guarantees termination + the report card. `lesson_end_request` does the same (encouraging recap → end). The `end_lesson` tool is hard-guarded by `session_state_service.is_end_allowed` → returns `end_not_allowed` mid-lesson.

### Agentic Tools — split + per-turn filtering
Three tool files: **`session_tools.py`** = in-lesson view only (slides + puzzles), **`platform_tools.py`** = platform/lifecycle/data (`generate_quiz`, mastery, `evaluate_answer`, `advance_lesson_phase`, `create_assignment`, `load_resource`, `pause_lesson`/`resume_lesson`, `end_lesson` (guarded), `generate_session_report`, web/deep search), **`chat_tools.py`** = `/chat` subset. `tools/registry.py` `make_tools(ctx, groups)` assembles by group: `teaching · puzzles · assessment · mastery · platform · lifecycle · research` (logs `TOOLS bound groups=…`).

`_run_turn` computes a **small, intent-driven** group set via `select_tool_groups(event_kind, intent_text, has_slides, end_allowed, quiz_phase)` — driven by the student's keyword intent + the event kind + the quiz-timing gate. A plain teaching turn binds just `teaching` (or `puzzles` when there are no slides); `assessment` only on quiz intent / quiz phase; `lifecycle` (end/report) only when `end_allowed`; etc. (was ~14 tools every turn → now a handful). Passed to `gemini_service.stream_response_async(..., tool_groups=…)`; the LESSON STATE anchor advertises "AVAILABLE ACTIONS THIS TURN" so binding + prompt agree (anti-hallucination, per LangChain dynamic-tool-subsetting guidance).

**Event persistence:** interactive/lifecycle events (puzzle/quiz/pause/resume/timeout/ended) are saved as **`role:"event"`** chat messages via `_emit_event` (echo + DB persist) so they survive a refresh/reopen; `chat_service.build_context` filters `role="event"` out of the LLM history (it would otherwise become a stray `AIMessage`). The WS **stays open during pause** (a `lesson_pause` event, not a socket close), so lifecycle events always reach the backend. Full plan: `~/.claude/plans/cryptic-orbiting-bentley.md`.

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

## Major Upgrade — Auth + Multi-Tenant Schools + Visual Puzzles

> **Status: IMPLEMENTED.** Full plan: `~/.claude/plans/cryptic-orbiting-bentley.md`.
> (The Resource Hub curriculum/slides integration is also live — documented in the RAG + session-slide sections above; it remains the curriculum/content source.)

Three phases shipped on top of the base platform: a SaaS auth overhaul, school multi-tenancy, and a Synthesis-style interactive puzzle engine.

### Phase 1 — Auth: Google OAuth + email verification + Casbin RBAC
- **Dual-mode signup** (`POST /api/auth/register` with `account_type`):
  - `school` → creates a `School` + the registrant as its **superadmin** (new role).
  - `individual` (student/parent) → attached to the default school **"Smart Tuition (United Kingdom & United Arab Emirates)"** (`is_default`, `account_type=individual_host`).
- **Flow:** register → email verification (link emailed; in dev `EMAIL_ENABLED=false` so the link is logged + returned as `dev_verify_token`) → onboarding (profile + preferences) → login. Login blocks unverified users (`403 email_unverified`). **Google OAuth** via Authlib (`/api/auth/oauth/google/login` + `/callback`, gated to `503` until `GOOGLE_CLIENT_ID/SECRET` set); needs `SessionMiddleware` (added in `main.py`).
- **Casbin RBAC** (`services/casbin_service.py` + `core/casbin_model.conf`, RBAC-with-domains, async SQLAlchemy adapter → `casbin_rule`). Casbin answers role→obj→act; **cross-school isolation is enforced at the service layer** (school_id filters). New dep `middleware/auth.require_permission(obj, act)`; the old `require_role(...)` stays. Policies seeded in `seed.py` / on startup.
- **Models:** `models/school.py` (`School`), `models/auth_tokens.py` (`EmailVerificationToken`, `OAuthIdentity`); `User` gained `school_id`, `is_verified`, `onboarding_completed`, `auth_provider`, `account_type`, nullable `password_hash`, and the `superadmin` role. Emails go through `platform_service.send_verification_email/send_password_reset` (single email path; no separate email_service).
- **Frontend:** `RegisterPage` mode selector (🏫 School / 👤 Individual) + Google button; `LoginPage` Google + unverified-resend; new `VerifyEmailPage`, `OnboardingPage`, `OAuthCallbackPage`; route guards in `App.tsx` (unverified→`/verify-email`, `!onboarding_completed`→`/onboarding`).

### Phase 2 — School multi-tenancy
- `routers/school.py` (superadmin/admin-scoped): `GET /api/school/me` (stats), `PATCH /api/school`, `GET/POST /api/school/users`, `PATCH /api/school/users/{id}/active`. All reads/writes scoped to the caller's `school_id` → schools can't see each other's users. `services/school_service.py` holds the default-school accessor + CRUD.
- Frontend `pages/SchoolDashboard.tsx` (superadmin landing at `/school/dashboard`): member stats, add/deactivate teachers/students/parents.

### Phase 3 — Visual puzzle engine (Synthesis-style)
- The AI never free-draws — it **selects a pre-authored template** + params. `services/puzzle_templates.py` (registry tagged by subject + key_stage) + `services/puzzle_service.py` (`build` validates/solves; `list_available`; persists to `LessonPlan.session_state["puzzle_state"]`).
- New `session_tools.py` tools: `list_available_puzzles()`, `show_puzzle(puzzle_id, params)`, `clear_puzzle()`. `show_puzzle` returns `{action:"show_puzzle", ...}` → WS `{type:"tool", tool:"show_puzzle"}` (same pipeline as slides). The student's attempt returns via a new WS message `puzzle_result` → `session_agent_service._handle_puzzle_result` → the AI praises/advances or hints. System prompt has a **VISUAL PUZZLES** block.
- Templates v1 (Maths + Science): SVG — `fraction_bar`, `number_line`, `shape_count`, `area_grid`; react-konva — `build_fraction`, `label_diagram`, `states_of_matter`, `food_chain_order`.
- Frontend `components/PuzzlePlayer.tsx` + `components/puzzles/*` render by `render` key; `useSessionChannel.sendPuzzleResult(...)` mirrors `sendQuizResult`; `SessionPage` shows the puzzle in the Learn panel (overlays the slide while active).

### Config / env (new) + activation
- `.env`/`config.py`/`docker-compose.yml`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE_URL`, `SESSION_SECRET`, `FRONTEND_BASE_URL`, `EMAIL_ENABLED`(+SMTP). Deps added: `Authlib`, `itsdangerous`, `casbin`, `casbin-async-sqlalchemy-adapter` (backend); `konva`, `react-konva` (frontend).
- **After pulling these changes:** rebuild backend, then `docker compose exec backend python -m app.setup` (adds `users` columns + `schools`/token/`casbin_rule` tables) then `python -m app.seed` (default school + Casbin policies + backfills seed users verified/onboarded). Without `setup`, existing-DB logins 500 on the new columns.
