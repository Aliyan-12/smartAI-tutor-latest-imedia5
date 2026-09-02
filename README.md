# SmartAI Tutor

AI-powered tutoring platform for UK GCSE curriculum (KS1–KS5) with structured AI lessons, text chat, real-time voice conversation, **interactive visual puzzles**, and RAG-based knowledge retrieval. Multi-tenant for schools, with Google OAuth + email-verified accounts and Casbin RBAC.

Lessons run on a **multi-agent pipeline** (LangChain orchestration → CrewAI specialist agents → Gemini): a **Navigator** routes each turn by lesson phase to one of an **Intro / Teacher / Practitioner / Summarizer** agent, each with a narrow remit and only its phase's tools — which keeps the tutor accurate and stops the repetition/hallucination a single over-scoped agent falls into.

## Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 17 with [pgvector extension](https://github.com/pgvector/pgvector)
- Google Gemini API key ([get one here](https://aistudio.google.com/apikey))

## Local Setup (Step by Step)

### 1. Clone and configure

```bash
git clone <repo-url>
cd smartAI-tutor-latest-imedia5
cp .env.example .env
```

Edit `.env` and set your values:
```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_pg_password
POSTGRES_DB=smartai_tutor
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

### 2. Install pgvector (if not already installed)

pgvector is required for the RAG knowledge base. On Windows with PostgreSQL 17:

1. Download prebuilt binary from [andreiramani/pgvector_pgsql_windows](https://github.com/andreiramani/pgvector_pgsql_windows/releases)
2. Extract and copy files into your PostgreSQL installation:
   - `vector.dll` -> `C:\Program Files\PostgreSQL\17\lib\`
   - `vector.control` + `*.sql` files -> `C:\Program Files\PostgreSQL\17\share\extension\`
   - Header files -> `C:\Program Files\PostgreSQL\17\include\server\extension\vector\`
3. Restart PostgreSQL service

On Linux/Mac: `apt install postgresql-17-pgvector` or build from source.

### 3. Create the database

Open pgAdmin or psql and create the database:
```sql
CREATE DATABASE smartai_tutor;
```

### 4. Set up the backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac

pip install -r requirements.txt

# Create tables (pgvector extension + HNSW index)
python -m app.setup --fresh

# Seed default users (admin, teacher, student)
python -m app.seed
```

### 5. Start the backend

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload --ws-ping-timeout 300 --ws-ping-interval 30
```

The `--ws-ping-timeout` and `--ws-ping-interval` flags are needed for the real-time voice WebSocket to stay alive during long conversations.

### 6. Set up and start the frontend

```bash
cd frontend
npm install
npm run dev
```

### 7. Open the app

- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8001/docs

### 8. Log in and start a lesson

Curriculum + teaching content sync **automatically** from the external **Resource Hub** into the
`rh_*` tables (first sync runs ~1 minute after startup; tune with `RESOURCE_SYNC_*` in `.env`). No
manual upload needed — the legacy admin-upload knowledge base is dormant.

1. Log in as student: `student@smartai.com` / `student123`
2. Go to **Subjects** → pick Key Stage / Year / Subject / Unit / Topic → start the lesson
3. The AI teaches slide-by-slide from the synced content, with interactive puzzles, visuals, and
   optional real-time voice

## Default Logins

| Role | Email | Password |
|---------|--------------------------|-------------|
| Administrator | administrator@smartai.com | administrator123 |
| Admin | admin@smartai.com | admin123 |
| Teacher | teacher@smartai.com | teacher123 |
| Student | student@smartai.com | student123 |
| Parent | parent@smartai.com | parent123 |

> Seed users are created verified/onboarded/approved. New School-mode signups must verify their email **and** be approved by the administrator before they can log in.

## Project Structure

```
backend/
  app/
    core/           # Config, security (JWT, bcrypt)
    db/             # Database session, init
    middleware/     # Auth guards, rate limiting
    models/         # SQLAlchemy models (users, chats, documents, subscriptions)
    routers/        # API endpoints (auth, chat, voice, admin, teacher, documents)
    schemas/        # Pydantic request/response models
    tools/          # Agentic tools bound per turn (see TOOLS.md): session_tools (slides),
                    #   visual_tools, puzzle_tools, platform_tools, chat_tools, registry
    services/       # Business logic
      agent/
        session/    # The session pipeline (turn loop, anchor, prompt, resources, state,
                    #   voice, lesson plan) — core.py · resources.py · state.py · voice.py · plan.py
        teacher_service.py   # Teaching visuals: SVG diagrams + Manim animations + mermaid
        practice_service.py  # Puzzles + manipulatives + graphs + math/eval/state
        agent_crew/          # The crew: roles · navigator · runner · tool adapter · llm
      jobs/sync_service.py   # Resource Hub client + curriculum/resource sync jobs
      chat_service.py        # Chat CRUD + RAG context building
      gemini_service.py      # Gemini streaming + RAG injection + tool loop
      rag_service.py         # Gemini embeddings + pgvector cosine retrieval
      coverage_ledger.py     # Per-lesson "already covered" memory (anti-repetition)
      platform_service.py    # Credits, XP/streaks, email
      casbin_service.py · oauth_service.py · school_service.py · user_service.py
    setup.py        # Database table creation
    seed.py         # Default user seeding
    main.py         # FastAPI app entry point

frontend/
  src/
    components/     # Sidebar, ChatWindow, ChatInput, WelcomeScreen
    context/        # AuthContext (JWT state)
    hooks/          # useSessionChannel (chat/session WS), useVoiceCapture (mic VAD), useVoice (Read-aloud TTS)
    pages/          # ChatPage, LoginPage, RegisterPage, AdminDashboard,
                    #   TeacherDashboard, KnowledgeBasePage
    services/       # API client (all endpoints)
    styles/         # CSS
    types/          # TypeScript interfaces

docker-compose.yml
.env / .env.example
```

## Docker Setup

```bash
cp .env.example .env   # edit GEMINI_API_KEY
docker-compose up --build
# Frontend: http://localhost:3000
# Backend: http://localhost:8001
```

The Docker setup uses the `pgvector/pgvector:pg17` image which includes pgvector pre-installed.

## Key Features

- **Multi-agent lesson pipeline** (LangChain → CrewAI → Gemini): a **Navigator** routes each turn by lesson phase to a narrow specialist — **Intro/Recap → Teacher → Practitioner → Summarizer** — each bound to only its phase's tools. A shared per-lesson **coverage ledger** ("already covered") plus per-agent scope-guards stop repetition and hallucination; time per phase scales by Key Stage (KS1 most scaffolding → KS5 least). The AI works tool-first: think → call the right tool silently → speak from the result. See **`TOOLS.md`** for every tool.
- **Structured AI Lessons + Lesson State Engine**: goal/duration-specific lesson plans; every session turn carries an authoritative, live **LESSON STATE** anchor (real-time server-computed clock, current phase/step + what's-next, student learning status, and the on-screen puzzle) injected at maximum recency so the AI never loses track or hallucinates tool state in long sessions. The AI teaches **slide-by-slide** from Resource Hub content (slide tools are gated on whether the lesson actually has resources)
- **Interactive Visual Puzzles** (Synthesis-style): the AI selects a pre-authored template (Maths + Science, KS1–KS5) and shows it via `show_puzzle`; rendered as SVG + react-konva manipulatives, each tagged with a **category** chip (labelling, matching, recognition, …). Includes **image puzzles** — `identify_image` / `match_image` — that use real curriculum-topic images from a cached **topic-image catalog** (Wikipedia lead images per topic; seed with `python -m app.seed_topic_images`). Authoritative puzzle state (per-show `instance_id`, solved/attempted tracking) makes "show → solve → next puzzle → reset" reliable
- **"Thinking" strip**: instead of voice fillers, each turn shows Claude-style one-line steps — what tool the tutor ran + a brief thought summary — persisted in the chat so they survive a refresh
- **Auth & Multi-tenant Schools**: dual-mode signup (School / Individual), **Google OAuth** (Authlib) + email verification, multi-step onboarding, **Casbin** RBAC; a platform **administrator** approves school-admin signups, each **admin** is scoped to their own school
- **RAG Knowledge Base**: curriculum + teaching files come from the external **Resource Hub** (mirrored into `rh_*` tables), vectorized per-slide and retrieved via pgvector HNSW index
- **Real-time Voice**: custom STT (Gemini) → turn → warm Kokoro **`af_heart`** TTS over the chat/session WebSocket, with client-side mic VAD
- **Multi-role**: Administrator (all schools), Admin (own school), Teacher (manage content + monitor students), Student (lessons + chat + voice + puzzles), Parent (book + track children)
- **Credit System**: Per-message billing with subscription plans
- **Streaming**: one WebSocket per chat/session — **text streams immediately** (GPT-style); Kokoro TTS audio follows in the background as separate `segment_audio` frames, so text never waits on speech

## Environment Variables

| Variable | Description | Default |
|--------------------------|------------------------------------------|-----------------|
| POSTGRES_USER | Database username | - |
| POSTGRES_PASSWORD | Database password | - |
| POSTGRES_DB | Database name | smartai_tutor |
| POSTGRES_HOST | Database host | localhost |
| POSTGRES_PORT | Database port | 5432 |
| GEMINI_API_KEY | Google Gemini API key | - |
| GEMINI_SESSION_MODEL | In-lesson session model | gemini-2.5-flash |
| GEMINI_CHAT_MODEL | Free `/chat` model | gemini-2.5-flash |
| GEMINI_THINKING_BUDGET | Thinking tokens before each answer (0 = off) | 512 |
| GEMINI_IMAGE_MODEL | Native image generation ("Nano Banana") | gemini-2.5-flash-image |
| JWT_SECRET_KEY | JWT signing secret | - |
| JWT_EXPIRATION_MINUTES | Token expiry | 1440 |
| BACKEND_CORS_ORIGINS | Allowed CORS origins | localhost |
| RESOURCEHUB_API_KEY / _URL | External Resource Hub (curriculum + content) | - / hub… |
| EMBEDDING_MODEL | Embedding model | gemini-embedding-001 |
| RAG_CHUNK_SIZE | Tokens per chunk | 500 |
| RAG_CHUNK_OVERLAP | Overlap between chunks | 50 |
| RAG_TOP_K | Chunks retrieved per query | 5 |
| RAG_MIN_SIMILARITY | Minimum similarity threshold | 0.3 |
| RAG_ENABLED | Enable/disable RAG | true |
| UPLOAD_DIR | Document upload directory | uploads/documents |
| MAX_UPLOAD_SIZE_MB | Max file upload size | 50 |

---

## Production feature set

On top of the core lesson/RAG/voice/puzzle platform, the following production areas are implemented
(each developed on its own branch — see **Branch structure** below):

- **Auth & tenancy** — JWT with session revocation (`token_version` = "log out of all devices"),
  Google OAuth, email verification, Casbin RBAC, multi-tenant schools with strict cross-school isolation.
- **School verification** — a state-machine approval workflow (draft → submitted → under_review →
  verified/rejected) with evidence upload, duplicate checks and an audit trail.
- **Student learning preferences** — bounded, persisted preferences (learning style, pace, practice,
  challenge, interests, goals) that **drive the live tutor prompt**; an app-wide accessibility layer
  (text size, dark mode, reduced motion, high contrast) applied on boot.
- **Role settings** — parent (children, secure invite-code linking, notifications, billing), teacher
  (classroom defaults consumed by the booking flow), and a scoped, audited **platform settings centre**
  whose values change real behaviour (maintenance mode, default credits, school policy).
- **Billing** — a provider-abstracted engine (Stripe, with a credential-free mock for dev), an
  **immutable credit ledger**, idempotent webhooks (no double-crediting), parent subscriptions, and a
  school wallet with top-ups/requests, manual credits, refunds and invoices. Card data never touches
  the backend.
- **Evidence-based mastery** — a deterministic, versioned algorithm separating performance from
  confidence, weighting exact evaluators above LLM grading, with recency decay and "why this score?"
  explanations. Auto-seeds from history so it's dynamic on first view.
- **Reporting** — parent child-progress and teacher class-progress trackers (heatmap, distribution)
  reading authorised, tenant-scoped data.
- **Notifications & audit** — a central preference-aware, deduplicated notification service with an
  in-app centre + bell, plus a sensitive-data access audit.
- **Observability & security** — request/correlation IDs, structured logs, safe error responses,
  readiness + dependency health, an admin metrics/reconciliation endpoint, and sensitive-endpoint rate
  limits. See `docs/security/SECURITY_AUDIT.md`.
- **Navigation** — a central typed navigation registry (`frontend/src/lib/navigation.tsx`); the sidebar
  is a renderer over it, with role-correct destinations and no stale "Soon"/disabled items.

### Setup for the full stack

```bash
docker compose up -d --build
docker compose exec backend python -m app.setup --fresh   # clean bring-up: drop, recreate, migrate, seed
# (--fresh is recommended for a clean install; each migration now runs in its own transaction)
```

### Branch structure

Work is delivered as a linear stack of per-feature branches off `master`, in dependency order, so
`git merge --ff-only origin/<branch>` works end-to-end and each branch's own commits are one feature:

```
feat/ui-design-system-shell → feat/ui-icons-fonts-accessibility → feat/legal-privacy-compliance →
feat/school-verification-workflow → feat/student-learning-preferences → feat/parent-account-settings →
feat/teacher-settings → feat/admin-platform-settings → feature/payments-token-billing →
feat/progress-mastery-engine → feat/parent-progress-tracker → feat/teacher-progress-tracker →
feat/reports-notifications-audit → feat/production-security-observability-qa →
feat/navigation-information-architecture
```

Open each PR against the **previous** branch to review exactly one feature's diff.
