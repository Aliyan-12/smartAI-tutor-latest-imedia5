# SmartAI Tutor — Project Summary

A commercial AI tutoring platform for the UK GCSE curriculum (Key Stages 1–5). It delivers
structured, curriculum-grounded AI lessons through text, real-time voice, and interactive visual
puzzles — multi-tenant for schools, with Google OAuth + email-verified accounts and Casbin RBAC.
Deployed at **dev.smartaitutor.online**.

This is a high-level summary. For the working detail see **`CLAUDE.md`** (architecture + rules),
**`TOOLS.md`** (every agent tool), and **`README.md`** (setup).

---

## What it is

Curriculum and teaching content come from an external **Resource Hub** — the single source of truth
for the whole tree (Key Stage → Year Group → Subject → Unit → Topic) and every teaching file
(slides, worksheets, mark schemes, homework, videos, links). Scheduled jobs mirror it into local
`rh_*` tables and vectorize file content **per slide** into pgvector. When the AI teaches a slide or
a student asks a question, the relevant chunks are retrieved (pgvector cosine, top-5) and injected
into the Gemini prompt, producing accurate, curriculum-aligned lessons.

---

## Lesson architecture — the multi-agent pipeline

Lessons run as **LangChain (orchestration) → CrewAI (specialist agents) → Gemini → response**. A
deterministic **Navigator** routes every student turn, by lesson phase and clock, to ONE narrow
specialist agent — each with a short remit and only its phase's tools:

```
Navigator (routes by phase + time; reinforces scope)
   recap    → Intro / Recap      brief reconnection, prior-knowledge check
   teach    → Teacher            slide-by-slide, one idea + one visual per turn
   practice → Practitioner       hands-on puzzles built on what was taught
   quiz     → Practitioner       the single end-of-practice quiz
   review   → Summarizer         concise recap + report + next steps (the only closer)
```

Why: a single over-scoped agent (all phases, all tools, one giant prompt) overfits and starts
repeating, re-asking and misusing tools. The narrow agents fix that, reinforced by:

- **Coverage ledger** — a per-lesson record of slides taught / questions asked / puzzles played /
  quiz done, injected as "already covered" so nothing repeats and the Practitioner builds on the
  Teacher.
- **Tool-first, accurate behaviour** — the AI thinks → calls the right tool silently → speaks from
  the result; it never claims an action it didn't take, never guesses a number, and double-checks
  every calculation.
- **Per-Key-Stage pacing** — time per phase scales by KS (KS1 most recap/scaffolding → KS5 least);
  KS1–KS2 teaching is interactive, KS3+ moves through slides briskly.

Real-time delivery is unchanged: one WebSocket per chat/session streams the reply as ordered
sentence **segments** (text immediately; warm **Kokoro** TTS audio follows as separate frames);
voice turns transcribe mic audio (Gemini STT) first, then run the identical turn pipeline.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite (5173 dev / 3000 Docker) |
| Backend | FastAPI, Python 3.11 (8001) |
| Database | PostgreSQL 17 + pgvector (HNSW cosine, 768-d) |
| AI — text | Google Gemini via CrewAI (lessons) + LangChain (`/chat`, tools) |
| AI — voice | Gemini STT → Kokoro `af_heart` TTS over the session WebSocket |
| Auth | JWT + Google OAuth (Authlib) + email verification; Casbin RBAC |
| Puzzles | SVG + react-konva interactive manipulatives; Manim animations |

---

## User roles

| Role | Access |
|------|--------|
| Administrator | Platform-wide across all schools; approves school-admin signups |
| Admin (school) | Same dashboard, scoped to their own school's users/sessions |
| Teacher | Manage students + content, view histories, book sessions, reports |
| Student | Lessons (text/voice) + puzzles + quizzes + progress |
| Parent | Link children, book sessions, track progress/reports |

---

## Structure (high level)

```
backend/app/
  routers/      REST + WebSocket endpoints (auth, chat, voice, sessions, curriculum, …)
  models/       SQLAlchemy (users, schools, appointments, lesson_plan, assessments, rh_* mirror)
  tools/        agentic tools bound per turn — see TOOLS.md
  services/
    agent/
      session/          the session pipeline (turn loop, anchor, prompt, resources, state, voice, plan)
      teacher_service   teaching visuals (SVG + Manim + mermaid)
      practice_service  puzzles + manipulatives + graphs + math/eval/state
      agent_crew/       the crew — roles · navigator · runner · tool adapter · llm
    jobs/sync_service   Resource Hub client + curriculum/resource sync jobs
    chat_service · gemini_service · rag_service · coverage_ledger · platform_service · casbin/oauth/school/user

frontend/src/     pages, components (ChatWindow, ResourceViewer, PuzzlePlayer, puzzles/*),
                  context (auth), hooks (session WS, voice capture), services (typed API)
```

---

## Key capabilities

- **Structured goal-specific lessons** — a booked plan (goal × duration) drives time-boxed phases;
  every turn carries an authoritative **LESSON STATE anchor** (live clock, phase/next, mastery,
  on-screen puzzle, already-covered) so the model never loses track over a long session.
- **Interactive visual puzzles** — Synthesis-style manipulatives + labelling/matching/maths/graph
  puzzles; the AI passes params only, the server derives + marks deterministically (no
  self-contradiction). Model-authored SVG/Manim run behind an allow-list sanitiser + AST/process
  sandbox (XSS/RCE-safe).
- **Valid-KaTeX maths** — the AI authors LaTeX directly (no server repair); an invalid formula
  bounces back for the AI to re-emit (validate → fix → retry).
- **RAG** — per-slide vectorized Resource Hub content, tightly scoped per lesson.
- **Auth + multi-tenant schools** — dual-mode signup, Google OAuth, email verification, Casbin RBAC.
- **Gamification** — XP, streaks, topic mastery, session report cards; per-message credits.

---

## Running

```bash
docker compose up -d --build                 # full stack (frontend :3000, backend :8001, db :5432)
docker compose exec backend python -m app.setup   # create/upgrade schema
docker compose exec backend python -m app.seed    # default school + users + policies
```

Local dev and env variables: see **`README.md`** and **`.env.example`**. Default test logins are in
`README.md` / `CLAUDE.md`.
