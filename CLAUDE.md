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

### Goal-Specific Lesson Plan (backend-enforced)
At booking time, `appointments.py` calls `lesson_structure_service.auto_create_lesson_plan()` which creates a `LessonPlan` record with `plan_blocks` — time-boxed steps specific to the chosen **goal** (learn_scratch, homework, catch_up, revision) × **duration** (20/40/60/90 min).

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

### RAG Knowledge Base
- Documents tagged by: Key Stage, Subject, Exam Board, Tier, Unit
- Chunks embedded with `gemini-embedding-001`, stored in pgvector with HNSW index
- Top-5 chunks retrieved per query at cosine similarity ≥ 0.3
- Injected into Gemini system prompt as context

### TTS Mute Fix (SessionPage.tsx)
- `ttsEnabledRef = useRef(true)` + sync effect; all callbacks read `ttsEnabledRef.current` (not stale `ttsEnabled` state)
- `cancelStreamTTS` is destructured from `useVoice` and called immediately when user mutes
- `onToken` callbacks are gated: `(t: string) => { if (ttsEnabledRef.current) feedStreamTTS(t); }` — stops feeding the TTS API mid-stream if muted
- When muted: zero calls to `/api/voice/speak`

### Quiz QUIZ_OFFER Topic Rule
The AI must write specific concepts taught in QUIZ_OFFER, not generic unit names:
- ✅ `[QUIZ_OFFER: topic="eukaryotic vs prokaryotic cells, light microscope magnification"]`
- ❌ `[QUIZ_OFFER: topic="Cell-structure-1, Cell-structure-and-using-a-light-microscope-"]`
`gemini_service.generate_mcq_questions()` enforces topic scope even when KB content spans broader material.

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

---

## Agentic AI — Gemini Tool Calling + Kokoro TTS — Implementation Plan

> **Status: PLANNED — awaiting user confirmation to implement.**
> Do NOT start implementation until explicitly confirmed.

### Core Insight — Why "LangChain as adapter" is weak, and what's actually valuable

Using LangChain purely as an API wrapper around Gemini adds almost nothing. The genuine transformation is converting Gemini from a **text generator** into a **tutoring agent** — one that can take real actions inside the platform by calling tools.

**Current state (primitive text markers):**
```
Gemini outputs text: "Let's test you! [QUIZ_OFFER: topic='eukaryotic cells']"
Regex in frontend: parses [QUIZ_OFFER] → triggers quiz UI
```

**New state (agentic tool calls):**
```
Gemini calls: generate_quiz(topic="eukaryotic cells", difficulty="medium", count=5)
Tool runs: creates Assessment record in DB, returns structured questions
Gemini continues: "Here's your quiz — good luck!"
Frontend receives: structured quiz data via SSE tool_result event
```

The difference is architectural: parameterized, DB-integrated, no regex hacks, Gemini decides *when* and *what* to call, not just *what text to output*.

LangChain's actual value here: `bind_tools()` registers tool schemas with Gemini's native function calling API. `@tool` decorator defines tools cleanly. The tool executor loop handles the back-and-forth between Gemini and tool results.

### Goals
1. Bind a suite of educational tools to Gemini — it calls them autonomously during sessions instead of outputting text markers.
2. New tools: **Worksheet Generator**, **Assignment Generator**, **Flashcard Generator**, **Lesson Phase Controller**, **Student Progress Reader**, **Knowledge Base Search**.
3. Upgrade existing tools: **Quiz Tool** replaces the `[QUIZ_OFFER]` regex hack with a real function call.
4. Replace Gemini TTS + gTTS with **Kokoro-82M** local neural TTS — free, local, sub-0.3s.
5. Keep Gemini 2.5 Pro as the brain — tools extend its reach into the platform's data and actions.

---

### Architecture Shift — Text Markers → Real Tool Calls

```
CURRENT (primitive):
  Student message → Gemini generates text → regex parses [QUIZ_OFFER] → UI reacts
  Gemini has no idea what happened — it just output a string

NEW (agentic):
  Student message → Gemini thinks → decides to call generate_quiz(topic, difficulty, count)
  Tool creates Assessment record in DB → returns structured data
  Gemini incorporates result → streams coherent response
  SSE sends tool_result event → frontend renders quiz card inline
```

### What Changes vs What Stays

| File / Location | Action | Reason |
|---|---|---|
| `services/llm_service.py` | **CREATE** | LangChain hub — `get_llm(task, tools=[])` with bound tool schemas |
| `tools/` directory | **CREATE** | 8 tool files, each a `@tool`-decorated async function |
| `services/tool_executor.py` | **CREATE** | Detects tool calls in Gemini response, dispatches, injects results |
| `services/gemini_service.py` | **REWRITE internals** | Use `llm_service`; true async stream; delete JSON repair hacks |
| `services/voice_service.py` | **REWRITE `text_to_speech()`** | Kokoro-82M local TTS; signature unchanged |
| `models/worksheet.py` | **CREATE** | New `worksheets` DB model |
| `models/flashcard_set.py` | **CREATE** | New `flashcard_sets` DB model |
| `routers/tools.py` | **CREATE** | REST endpoints: GET worksheet, GET flashcards, download PDF |
| `main.py` | **EXTEND** | Register new router; Kokoro pre-warm in lifespan |
| `requirements.txt` | **EXTEND** | LangChain + Kokoro + reportlab |
| `core/config.py` | **EXTEND** | `kokoro_voice` setting |
| `setup.py` | **EXTEND** | Migrations for `worksheets` + `flashcard_sets` tables |
| `seed.py` | **EXTEND** | Seed default worksheet templates |
| `session_agent_service.py` | **UNCHANGED** | System prompt logic is LLM-agnostic |
| `lesson_structure_service.py` | **UNCHANGED** | Pure data, no LLM calls |
| `embedding_service.py` | **UNCHANGED** | Gemini 768d embeddings — existing vectors must stay valid |
| All existing routers | **UNCHANGED** | SSE/WS/REST contracts identical |
| Frontend `SessionPage.tsx` | **EXTEND** | Handle new SSE event types: `tool_call`, `tool_result` |
| Frontend `ProgressPage.tsx` | **EXTEND** | Flashcard sets panel |
| Frontend `AssignmentsPage.tsx` | **EXTEND** | AI-generated assignment cards |

---

### Phase 1 — `llm_service.py` (LangChain Hub with Tool Binding)

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.language_models import BaseChatModel

_gemini_pro: ChatGoogleGenerativeAI | None = None
_gemini_flash: ChatGoogleGenerativeAI | None = None

def get_llm(task: str = "chat", tools: list = None) -> BaseChatModel:
    """
    task="session" | "quiz" | "report"  →  gemini-2.5-pro   (deep reasoning)
    task="chat"                          →  gemini-2.5-flash  (fast streaming)
    tools=[...]                          →  binds tool schemas to the model call
    """
    global _gemini_pro, _gemini_flash
    use_pro = task in {"session", "quiz", "report"}
    base = _init_pro() if use_pro else _init_flash()
    return base.bind_tools(tools) if tools else base

def _init_pro():
    global _gemini_pro
    if _gemini_pro is None:
        _gemini_pro = ChatGoogleGenerativeAI(
            model=settings.gemini_model,       # gemini-2.5-pro
            google_api_key=settings.gemini_api_key,
            temperature=0.7, streaming=True, max_retries=5,
        )
    return _gemini_pro

def _init_flash():
    global _gemini_flash
    if _gemini_flash is None:
        _gemini_flash = ChatGoogleGenerativeAI(
            model=settings.gemini_model_fast,  # gemini-2.5-flash
            google_api_key=settings.gemini_api_key,
            temperature=0.7, streaming=True, max_retries=5,
        )
    return _gemini_flash

# Session tool list — passed when building session chats
SESSION_TOOLS = []  # populated after tools/ are imported (avoids circular imports)
```

---

### Phase 2 — Tool Catalog (`backend/app/tools/`)

Eight tools. Each is a `@tool`-decorated async function. Gemini decides when and how to call them based on context.

---

#### Tool 1 — `quiz_tool.py` — Replaces `[QUIZ_OFFER]` regex hack

```python
@tool
async def generate_quiz(
    topic: str,
    difficulty: str = "medium",
    num_questions: int = 5,
    db_session_id: str = "",
) -> dict:
    """
    Generate an interactive quiz for the student on the given topic.
    Call this when the student has just finished learning a concept
    and is ready to be tested. difficulty: easy | medium | hard.
    """
    # Calls existing generate_mcq_questions() — no logic duplication
    questions = generate_mcq_questions(topic, subject, key_stage, num_questions=num_questions)
    assessment = await assessment_service.create_assessment(db, student_id, topic, questions)
    return {
        "assessment_id": assessment.id,
        "topic": topic,
        "questions": questions,
        "action": "show_quiz",          # frontend renders quiz card
    }
```

**Improvement over [QUIZ_OFFER]:** Parameters are explicit — Gemini specifies topic, difficulty, count. No regex. DB record created atomically. Return value injected back to Gemini so it can say "Here are 5 questions on X — take your time!"

---

#### Tool 2 — `worksheet_tool.py` — NEW

```python
@tool
async def generate_worksheet(
    topic: str,
    difficulty: str = "medium",
    num_questions: int = 8,
    include_answers: bool = False,
    question_types: list[str] = None,
) -> dict:
    """
    Generate a printable/interactive worksheet for the student.
    Call when the student needs structured practice on a topic, or
    when the teacher asks for practice material.
    question_types: ["short_answer", "multi_choice", "fill_blank", "worked_problem"]
    """
    # Gemini generates structured worksheet content via .with_structured_output()
    worksheet_data = await _generate_worksheet_content(
        topic, difficulty, num_questions, include_answers, question_types or ["short_answer", "multi_choice"]
    )
    # Save to DB
    worksheet = Worksheet(
        subject=subject, key_stage=key_stage, topic=topic,
        difficulty=difficulty, content=worksheet_data,
        appointment_id=appointment_id, student_id=student_id,
    )
    db.add(worksheet)
    await db.flush()
    return {
        "worksheet_id": worksheet.id,
        "topic": topic,
        "num_questions": num_questions,
        "download_url": f"/api/tools/worksheets/{worksheet.id}/pdf",
        "action": "show_worksheet",     # frontend renders worksheet card with download button
    }
```

**What this unlocks:** During a session, teacher or student says "can you make me a worksheet on quadratic equations?" → Gemini calls `generate_worksheet(topic="quadratic equations", difficulty="medium", num_questions=10)` → worksheet saved to DB → downloadable PDF link returned → student gets it inline in the chat.

---

#### Tool 3 — `assignment_tool.py` — NEW

```python
@tool
async def create_assignment(
    title: str,
    topic: str,
    instructions: str,
    difficulty: str = "medium",
    due_days: int = 7,
    estimated_minutes: int = 30,
    assignment_type: str = "homework",
) -> dict:
    """
    Create a homework assignment for the student.
    Call when the teacher asks to set homework, or at the end of a session
    to set follow-up practice. assignment_type: homework | revision | reading | prep.
    """
    # Creates real Homework + HomeworkAssignment records in the existing DB tables
    homework = Homework(
        teacher_id=teacher_id, title=title, subject=subject,
        key_stage=key_stage, topic=topic, instructions=instructions,
        due_date=datetime.now(timezone.utc) + timedelta(days=due_days),
        estimated_minutes=estimated_minutes, assignment_type=assignment_type,
    )
    db.add(homework)
    await db.flush()
    assignment = HomeworkAssignment(homework_id=homework.id, student_id=student_id, status="assigned")
    db.add(assignment)
    await db.flush()
    return {
        "homework_id": homework.id,
        "title": title,
        "due_date": homework.due_date.isoformat(),
        "action": "show_assignment",
    }
```

**What this unlocks:** Teacher is mid-session and says "set them revision homework on cell structure due Friday" → Gemini calls `create_assignment(title="Cell Structure Revision", topic="cell structure", due_days=3, ...)` → real `Homework` + `HomeworkAssignment` records created → shows up immediately in student's AssignmentsPage dashboard.

---

#### Tool 4 — `knowledge_tool.py` — RAG as explicit tool

```python
@tool
async def search_knowledge_base(
    query: str,
    subject: str = "",
    key_stage: str = "",
) -> dict:
    """
    Search the curriculum knowledge base for relevant content.
    Call when you need specific factual content, exam board information,
    or curriculum material to teach from. Do NOT call for every message —
    only when you genuinely need curriculum-specific facts.
    """
    chunks = await retrieve_relevant_chunks(db, query, subject or session_subject, key_stage or session_ks)
    if not chunks:
        return {"found": False, "content": ""}
    return {
        "found": True,
        "content": _format_rag_context(chunks),
        "sources": [c.document_title for c in chunks[:3]],
    }
```

**Why this is better than always-injecting RAG:** Currently RAG context is injected into EVERY message whether relevant or not — adding thousands of tokens and sometimes confusing Gemini. With this tool, Gemini decides when curriculum facts are needed and fetches only then. Smarter, cheaper, more accurate.

---

#### Tool 5 — `progress_tool.py` — Student mastery awareness

```python
@tool
async def get_student_mastery(topics: list[str]) -> dict:
    """
    Get the student's current mastery level for specified topics.
    Call at the start of a session or when deciding what depth to teach at.
    Returns: {topic: "not_started" | "learning" | "proficient" | "mastered"}
    """
    mastery_records = await _load_topic_mastery(db, student_id, subject, key_stage)
    result = {}
    for topic in topics:
        record = next((m for m in mastery_records if m.topic_name == topic), None)
        result[topic] = record.mastery_level if record else "not_started"
    return {"mastery": result}

@tool
async def update_topic_mastery(topic: str, performance: str) -> dict:
    """
    Update a student's mastery after practice or quiz.
    performance: "struggling" | "improving" | "confident" | "mastered"
    Call after a quiz score or after observing practice performance.
    """
    # Maps performance → mastery_level, updates TopicMastery record
    ...
    return {"topic": topic, "new_mastery": new_level}
```

**What this unlocks:** Session starts → Gemini calls `get_student_mastery(["photosynthesis", "cell respiration"])` → sees student is "proficient" at photosynthesis, "not_started" at cell respiration → skips basics for photosynthesis, teaches cell respiration from scratch. Adaptive without manual logic.

---

#### Tool 6 — `flashcard_tool.py` — NEW

```python
@tool
async def generate_flashcards(
    topics: list[str],
    count: int = 10,
    include_diagrams: bool = False,
) -> dict:
    """
    Generate spaced-repetition flashcards for revision.
    Call at the end of a topic or when the student asks for revision materials.
    """
    # Gemini generates Q&A pairs via .with_structured_output()
    cards = await _generate_card_content(topics, count)
    flashcard_set = FlashcardSet(
        student_id=student_id, subject=subject,
        key_stage=key_stage, topic=", ".join(topics), cards=cards,
    )
    db.add(flashcard_set)
    await db.flush()
    return {
        "flashcard_set_id": flashcard_set.id,
        "count": len(cards),
        "topics": topics,
        "action": "show_flashcards",
    }
```

---

#### Tool 7 — `lesson_control_tool.py` — Explicit phase transitions

```python
@tool
async def advance_lesson_phase(
    completed_step_title: str,
    reason: str,
    student_performance: str = "good",
) -> dict:
    """
    Explicitly advance the lesson to the next planned step.
    Call ONLY when the current step's task is fully complete.
    student_performance: "struggling" | "good" | "excellent"
    This updates the lesson plan state in the database.
    """
    # Increments current_step on LessonPlan, returns next step's ai_instruction
    lesson_plan = await _load_lesson_plan(db, appointment_id)
    next_step = _get_next_step(lesson_plan, completed_step_title)
    if lesson_plan:
        lesson_plan.current_step = next_step["order"]
        await db.flush()
    return {
        "next_step": next_step["title"],
        "ai_instruction": next_step["ai_instruction"],
        "step_type": next_step["type"],
    }
```

**What this unlocks:** Gemini explicitly declares "I am done with Worked Examples, moving to Guided Practice" — the DB reflects this. If the session is interrupted and resumed, it picks up at the correct step. No more guessing from message count.

---

#### Tool 8 — `answer_check_tool.py` — Structured evaluation

```python
@tool
async def evaluate_student_answer(
    question: str,
    student_answer: str,
    correct_concepts: list[str],
    mark_scheme: str = "",
) -> dict:
    """
    Evaluate a student's open-ended answer against the mark scheme.
    Call for practice questions and exam-style questions to give
    consistent, mark-scheme-aligned feedback.
    Returns score (0-3), specific feedback, misconceptions, and what to reinforce.
    """
    # Uses Gemini .with_structured_output() to evaluate
    evaluation = await _structured_evaluate(question, student_answer, correct_concepts, mark_scheme)
    # Updates TopicMastery based on score
    await _update_mastery_from_answer(db, student_id, subject, correct_concepts, evaluation.score)
    return {
        "score": evaluation.score,           # 0-3
        "max_score": 3,
        "feedback": evaluation.feedback,
        "misconceptions": evaluation.misconceptions,
        "reinforce": evaluation.what_to_reinforce,
    }
```

---

### Phase 3 — `tool_executor.py` (Handles Tool Call Loop)

When Gemini returns a `tool_calls` attribute on its message (instead of or alongside text), this service executes the tool, injects the result back, and lets Gemini continue.

```python
from langchain_core.messages import ToolMessage

async def execute_tool_calls(
    ai_message,           # AIMessage with .tool_calls from Gemini
    tool_map: dict,       # {tool_name: callable}
    db, student_id, appointment_id, ...
) -> list[ToolMessage]:
    """Run all tool calls from Gemini's response, return ToolMessage results."""
    results = []
    for tc in ai_message.tool_calls:
        tool_fn = tool_map.get(tc["name"])
        if tool_fn:
            result = await tool_fn.ainvoke({**tc["args"], "_db": db, "_student_id": student_id, ...})
            results.append(ToolMessage(content=str(result), tool_call_id=tc["id"], name=tc["name"]))
    return results

async def stream_with_tools(messages, llm_with_tools, tool_map, db, ...) -> AsyncGenerator:
    """
    Full agentic loop:
    1. Stream Gemini response
    2. If tool calls detected → execute → inject results → continue stream
    3. Yield text tokens + tool_result events to SSE
    """
    while True:
        tool_calls_detected = []
        async for chunk in llm_with_tools.astream(messages):
            if chunk.content:
                yield {"type": "token", "text": chunk.content}
            if chunk.tool_calls:
                tool_calls_detected.extend(chunk.tool_calls)

        if not tool_calls_detected:
            break  # No tools called — done

        # Execute tools and append results to message history
        tool_results = await execute_tool_calls(chunk, tool_map, db, student_id, ...)
        for tr in tool_results:
            yield {"type": "tool_result", "tool": tr.name, "data": json.loads(tr.content)}
        messages = messages + [chunk] + tool_results
        # Loop — Gemini continues with tool results in context
```

---

### Phase 4 — `gemini_service.py` Rewrite

Same public API. Three internal fixes:

**4a. True async stream** — replaces sync generator anti-pattern that blocks the event loop:
```python
async def stream_response_async(...) -> AsyncGenerator[str, None]:
    llm = get_llm("session" if system_prompt_override else "chat", tools=SESSION_TOOLS)
    messages = _build_lc_messages(history, user_message, rag_chunks, system_prompt)
    async for event in stream_with_tools(messages, llm, TOOL_MAP, db, ...):
        if event["type"] == "token":
            yield event["text"]
        else:
            yield f"\n[TOOL:{json.dumps(event)}]\n"  # SSE carries tool results as special tokens
```

**4b. Quiz generation** — delete `_repair_json` + `_extract_json_array`, replace with `.with_structured_output(list[MCQQuestion])`.

**4c. `_build_lc_messages()`** — replaces `_build_contents()` (Gemini SDK types → LangChain message types).

---

### Phase 5 — New DB Models

#### `models/worksheet.py`
```python
class Worksheet(Base):
    __tablename__ = "worksheets"
    id: int (PK)
    appointment_id: int (FK appointments, nullable)
    student_id: int (FK users)
    created_by: int (FK users — teacher or AI)
    subject: str
    key_stage: str
    topic: str
    difficulty: str           # easy | medium | hard
    content: dict (JSONB)     # {questions: [...], answers: [...], instructions: str}
    created_at: datetime
```

#### `models/flashcard_set.py`
```python
class FlashcardSet(Base):
    __tablename__ = "flashcard_sets"
    id: int (PK)
    student_id: int (FK users)
    subject: str
    key_stage: str
    topic: str
    cards: list (JSONB)       # [{front: str, back: str, hint: str, tags: [...]}]
    created_at: datetime
```

#### `setup.py` additions
```python
CREATE TABLE IF NOT EXISTS worksheets (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    subject VARCHAR(100) NOT NULL,
    key_stage VARCHAR(10) NOT NULL,
    topic VARCHAR(255) NOT NULL,
    difficulty VARCHAR(20) DEFAULT 'medium',
    content JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flashcard_sets (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(100) NOT NULL,
    key_stage VARCHAR(10) NOT NULL,
    topic VARCHAR(255) NOT NULL,
    cards JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `seed.py` addition
Seed 1 example worksheet template per key stage/subject so teachers see an example in the UI on first login.

---

### Phase 6 — `routers/tools.py` (New REST Endpoints)

```
GET  /api/tools/worksheets/{id}         → return worksheet JSON
GET  /api/tools/worksheets/{id}/pdf     → generate + return PDF (reportlab)
GET  /api/tools/flashcards/{id}         → return flashcard set JSON
GET  /api/tools/worksheets              → list student's worksheets
GET  /api/tools/flashcards              → list student's flashcard sets
```

PDF generation uses `reportlab` — produces a properly formatted A4 worksheet with header, questions numbered, answer lines, school logo placeholder.

---

### Phase 7 — Frontend SSE Handler Extension (`SessionPage.tsx`)

The SSE stream now carries a new event type for tool results:
```
data: {"type": "token", "text": "Here's your quiz on eukaryotic cells..."}
data: {"type": "tool_result", "tool": "generate_quiz", "data": {"assessment_id": 42, "questions": [...]}}
data: {"type": "tool_result", "tool": "generate_worksheet", "data": {"worksheet_id": 7, "download_url": "..."}}
data: {"type": "tool_result", "tool": "create_assignment", "data": {"homework_id": 15, "title": "...", "due_date": "..."}}
```

Frontend handles each `tool_result` type by rendering an inline card in the chat:
- `generate_quiz` → renders quiz UI (already exists, just new trigger)
- `generate_worksheet` → "Worksheet ready: [topic] — View | Download PDF"
- `create_assignment` → "Assignment set: [title] — due [date]"
- `generate_flashcards` → "Flashcards ready: [count] cards on [topic] — Study Now"
- `advance_lesson_phase` → silent (no UI card, just updates session state)
- `get_student_mastery` → silent (Gemini uses result internally)

---

### Phase 8 — Kokoro TTS (replaces Gemini TTS + gTTS)

Only `text_to_speech()` in `voice_service.py` changes. Signature is identical.

```python
from kokoro import KPipeline
import numpy as np, soundfile as sf, io

_kokoro: KPipeline | None = None

def get_kokoro():
    global _kokoro
    if _kokoro is None:
        _kokoro = KPipeline(lang_code='b')   # British English
    return _kokoro

def text_to_speech(text: str, lang: str = "en") -> tuple[bytes, str]:
    audio_chunks = [a for _, _, a in get_kokoro()(text.strip(), voice=settings.kokoro_voice)]
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(audio_chunks).astype(np.float32), samplerate=24000, format="WAV")
    return buf.getvalue(), "audio/wav"
```

Pre-warm in `main.py` lifespan to avoid cold-start:
```python
await asyncio.to_thread(get_kokoro)
```

---

### New Dependencies (`requirements.txt`)

```
# LangChain + Gemini provider
langchain>=0.3.0
langchain-core>=0.3.0
langchain-google-genai>=2.0.0
langchain-community>=0.3.0

# Kokoro local TTS
kokoro>=0.9.2
soundfile>=0.12.1

# PDF generation for worksheets
reportlab>=4.0.0
```

### Config additions (`config.py`)
```python
kokoro_voice: str = "bf_emma"   # British female — UK GCSE platform
```

---

### What Each Improvement Actually Delivers

| Current limitation | After this plan |
|---|---|
| `[QUIZ_OFFER]` regex hack — Gemini has no control over parameters | `generate_quiz(topic, difficulty, count)` — Gemini decides all parameters, DB record created |
| No worksheet capability | `generate_worksheet()` — AI generates on demand, downloadable PDF |
| Teacher must manually create homework in dashboard | `create_assignment()` — AI creates real DB record mid-session, appears in student dashboard instantly |
| RAG injected into every message (wasted tokens, noise) | `search_knowledge_base()` — AI fetches KB only when it decides it needs curriculum facts |
| AI has no awareness of student's current mastery | `get_student_mastery()` — AI checks before teaching, adapts depth and pace |
| Flashcards don't exist | `generate_flashcards()` — AI creates them after any topic, student studies from progress page |
| Lesson phase tracked by text output only | `advance_lesson_phase()` — explicit DB state update, session resumes at correct step |
| Answer evaluation is unstructured prose | `evaluate_student_answer()` — structured score (0-3), misconceptions list, mastery update |
| Gemini TTS billed per character | Kokoro-82M: free, local, natural British voice, ~0.1–0.3s |
| Sync generator blocks FastAPI event loop | True async `llm.astream()` via LangChain |
| Quiz JSON breaks with markdown fences | `.with_structured_output()` — schema-enforced JSON |

---

### Implementation Order

1. **`requirements.txt`** — add all deps
2. **`core/config.py`** — add `kokoro_voice`
3. **`models/worksheet.py`** + **`models/flashcard_set.py`** — new DB models
4. **`setup.py`** — add `worksheets` + `flashcard_sets` table migrations
5. **`seed.py`** — add example worksheet seeds
6. **Run `python -m app.setup`** — apply migrations
7. **`services/llm_service.py`** — LangChain hub with `get_llm(task, tools)`
8. **`tools/quiz_tool.py`** — first tool (upgrade existing quiz)
9. **`tools/worksheet_tool.py`** — worksheet generator
10. **`tools/assignment_tool.py`** — assignment creator
11. **`tools/knowledge_tool.py`** — RAG as tool
12. **`tools/progress_tool.py`** — mastery read/write
13. **`tools/flashcard_tool.py`** — flashcard generator
14. **`tools/lesson_control_tool.py`** — phase advancement
15. **`tools/answer_check_tool.py`** — answer evaluation
16. **`services/tool_executor.py`** — agentic tool loop
17. **`services/gemini_service.py`** — rewrite internals; delete JSON repair hacks
18. **`routers/tools.py`** — REST endpoints for worksheets/flashcards
19. **`main.py`** — register tools router, Kokoro pre-warm
20. **`services/voice_service.py`** — Kokoro TTS
21. **Frontend `SessionPage.tsx`** — handle `tool_result` SSE events
22. **Frontend `AssignmentsPage.tsx`** — AI-generated assignment cards
23. **Frontend `ProgressPage.tsx`** — flashcard sets panel
24. **Docker rebuild** — `docker compose build --no-cache backend frontend`

---

### Gotchas

1. **Tool context injection** — tools need access to `db`, `student_id`, `appointment_id`, `subject`, `key_stage` — these come from the session context, not from Gemini's parameters. Use a `ToolContext` dataclass passed to the tool executor, not as tool parameters (Gemini shouldn't specify student IDs)
2. **Streaming + tool calls** — Gemini can interleave text and tool calls in a single stream. The tool executor must buffer tool call chunks, execute them, then resume streaming — handle `chunk.tool_call_chunks` vs `chunk.content` separately
3. **`[QUIZ_OFFER]` backward compat** — keep the regex parser in `SessionPage.tsx` for the first few sessions after deploy; remove after confirming tool-based quiz works end-to-end
4. **reportlab PDF layout** — A4 worksheets need careful spacing; generate a test PDF locally before shipping
5. **`with_structured_output` + streaming** — cannot stream AND use structured output at the same time; quiz generation and worksheet content generation are non-streaming calls (they return complete JSON); only the main conversation stream uses `astream()`
6. **Kokoro `lang_code='b'`** — must match voice prefix: `'b'` for British (`bf_*`, `bm_*`), `'a'` for American (`af_*`, `am_*`)
7. **Tool loop depth** — cap at 3 tool call rounds per message to prevent infinite loops if Gemini gets confused
