# SmartAI Tutor

AI-powered tutoring platform for UK GCSE curriculum (KS1–KS5) with structured AI lessons, text chat, real-time voice conversation, **interactive visual puzzles**, and RAG-based knowledge retrieval. Multi-tenant for schools, with Google OAuth + email-verified accounts and Casbin RBAC.

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

### 8. Login and upload content

1. Login as teacher: `teacher@smartai.com` / `teacher123`
2. Go to **Knowledge Base** in the sidebar
3. Upload PDF/DOCX/PPTX files with the correct Key Stage, Subject, Exam Board, and Tier
4. Wait for status to change from "pending" to "ready"
5. Login as student: `student@smartai.com` / `student123`
6. Ask questions about the uploaded content - the AI will use document chunks as context

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
    services/       # Business logic
      chat_service.py        # Chat CRUD + RAG context building
      gemini_service.py      # Gemini API (streaming, RAG injection)
      embedding_service.py   # Gemini text-embedding-001
      retrieval_service.py   # pgvector cosine similarity search
      document_service.py    # PDF/DOCX/PPTX extraction, chunking
      scraper_service.py     # Web scraping, OneDrive/GDocs download
      voice_service.py       # TTS (gTTS)
      credit_service.py      # Credit deduction, subscriptions
      user_service.py        # User CRUD
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

The Docker setup uses `pgvector/pgvector:pg16` image which includes pgvector pre-installed.

## Key Features

- **Structured AI Lessons + Lesson State Engine**: goal/duration-specific lesson plans; every session turn carries an authoritative, live **LESSON STATE** anchor (real-time server-computed clock, current phase/step + what's-next, student learning status, and the on-screen puzzle) injected at maximum recency so the AI never loses track or hallucinates tool state in long sessions. The AI teaches **slide-by-slide** from Resource Hub content (slide tools are gated on whether the lesson actually has resources)
- **Interactive Visual Puzzles** (Synthesis-style): the AI selects a pre-authored template (Maths + Science, KS1–KS5) and shows it via `show_puzzle`; rendered as SVG + react-konva manipulatives. Authoritative puzzle state (per-show `instance_id`, solved/attempted tracking) makes "show → solve → next puzzle → reset" reliable
- **Auth & Multi-tenant Schools**: dual-mode signup (School / Individual), **Google OAuth** (Authlib) + email verification, multi-step onboarding, **Casbin** RBAC; a platform **administrator** approves school-admin signups, each **admin** is scoped to their own school
- **RAG Knowledge Base**: curriculum + teaching files come from the external **Resource Hub** (mirrored into `rh_*` tables), vectorized per-slide and retrieved via pgvector HNSW index
- **Real-time Voice**: custom STT (Gemini) → turn → Kokoro TTS over the chat/session WebSocket, with client-side mic VAD
- **Multi-role**: Administrator (all schools), Admin (own school), Teacher (manage content + monitor students), Student (lessons + chat + voice + puzzles), Parent (book + track children)
- **Credit System**: Per-message billing with subscription plans
- **Streaming**: one WebSocket per chat/session — turns stream as sentence segments with bundled TTS audio

## Environment Variables

| Variable | Description | Default |
|--------------------------|------------------------------------------|-----------------|
| POSTGRES_USER | Database username | - |
| POSTGRES_PASSWORD | Database password | - |
| POSTGRES_DB | Database name | smartai_tutor |
| POSTGRES_HOST | Database host | localhost |
| POSTGRES_PORT | Database port | 5432 |
| GEMINI_API_KEY | Google Gemini API key | - |
| GEMINI_MODEL | Generation model | gemini-2.5-flash |
| JWT_SECRET_KEY | JWT signing secret | - |
| JWT_EXPIRATION_MINUTES | Token expiry | 1440 |
| BACKEND_CORS_ORIGINS | Allowed CORS origins | localhost |
| BACKEND_PORT | Backend port | 8001 |
| EMBEDDING_MODEL | Embedding model | gemini-embedding-001 |
| RAG_CHUNK_SIZE | Tokens per chunk | 500 |
| RAG_CHUNK_OVERLAP | Overlap between chunks | 50 |
| RAG_TOP_K | Chunks retrieved per query | 5 |
| RAG_MIN_SIMILARITY | Minimum similarity threshold | 0.3 |
| RAG_ENABLED | Enable/disable RAG | true |
| UPLOAD_DIR | Document upload directory | uploads/documents |
| MAX_UPLOAD_SIZE_MB | Max file upload size | 50 |
