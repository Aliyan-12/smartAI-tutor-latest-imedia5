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

## LangChain + Kokoro TTS — Integration Plan

> **Status: PLANNED — awaiting user confirmation to implement.**
> Do NOT start implementation until explicitly confirmed.

### What This Is

Two backend-only integrations. No new routes. No DB migrations. No frontend changes. Four files touched.

---

### Why LangChain — Three Concrete Problems It Fixes

The raw Google Gemini SDK in `gemini_service.py` has three active bugs that LangChain resolves:

**Bug 1 — Fake async streaming** (`gemini_service.py:251–261`)
`stream_response_async()` is `async def` but internally calls the synchronous `stream_response()` generator. Every `yield` blocks the FastAPI event loop while waiting for Gemini's next token. Three concurrent sessions means three event-loop stalls.

**Bug 2 — JSON repair hacks** (`gemini_service.py:279–314`)
`generate_mcq_questions()` runs the output through `_repair_json()` + `_extract_json_array()` to fix trailing commas, markdown code fences, and control characters that Gemini embeds in its JSON. These fail silently on edge cases and produce `JSONDecodeError` in production.

**Bug 3 — Text-marker quiz** (`gemini_service.py:267–276`)
Gemini outputs `[QUIZ_OFFER: topic="..."]` as a raw string; the frontend regex-parses it. Gemini has no typed parameters, no DB record, no awareness of what happened after it output that string.

### What Changes — 4 Files Only

| File | Action | What changes |
|---|---|---|
| `services/llm_service.py` | **CREATE** | `ChatGoogleGenerativeAI` singleton, `get_llm(task, tools=None)` factory |
| `services/gemini_service.py` | **REWRITE internals** | True async `astream()`, `with_structured_output()` for MCQs, `@tool` quiz, delete JSON repair hacks + `_call_with_retry()` |
| `services/voice_service.py` | **REWRITE `text_to_speech()`** | Kokoro `KPipeline` replaces Gemini TTS API; signature unchanged |
| `main.py` | **EXTEND** | One line: Kokoro pre-warm in lifespan startup |
| `requirements.txt` | **EXTEND** | `langchain-google-genai>=4.0.0`, `kokoro>=0.9.2`, `soundfile>=0.12.1` |

Everything else is **UNCHANGED** — all routes, all frontend code, all DB models, all other services.

---

### Part 1 — LangChain

#### 1a. `services/llm_service.py` (new file)

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.language_models import BaseChatModel

_llm: ChatGoogleGenerativeAI | None = None

def get_llm(tools: list = None) -> BaseChatModel:
    global _llm
    if _llm is None:
        _llm = ChatGoogleGenerativeAI(
            model=settings.gemini_model_fast,
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            max_retries=5,          # replaces _call_with_retry() — 30 lines deleted
        )
    return _llm.bind_tools(tools) if tools else _llm
```

#### 1b. `stream_response_async` — true async (was fake)

```python
# BEFORE — sync generator disguised as async, blocks event loop on every token
async def stream_response_async(history, user_message, ...):
    for token in stream_response(...):   # <-- sync, starves concurrent sessions
        yield token

# AFTER — native async generator, event loop stays free
async def stream_response_async(history, user_message, ...):
    messages = _build_lc_messages(history, user_message, rag_chunks, system_prompt)
    async for chunk in get_llm().astream(messages):
        if chunk.content:
            yield chunk.content
```

#### 1c. `generate_mcq_questions` — structured output (kills JSON repair)

```python
from pydantic import BaseModel
from typing import List

class MCQQuestion(BaseModel):
    question_index: int
    question_text: str
    options: List[str]        # ["A) ...", "B) ...", "C) ...", "D) ..."]
    correct_answer: int       # 0-based index
    explanation: str
    topic_tag: str

# BEFORE — manual JSON repair that crashes on edge cases:
# raw = _extract_json_array(raw)
# raw = _repair_json(raw)
# return json.loads(raw)   ← JSONDecodeError in production

# AFTER — schema-enforced, always valid:
structured_llm = get_llm().with_structured_output(List[MCQQuestion])
questions = structured_llm.invoke(prompt)   # returns List[MCQQuestion], guaranteed
```

`_repair_json()`, `_extract_json_array()`, markdown-fence stripping — all deleted (~60 lines).

#### 1d. Quiz tool — `@tool` calling (replaces `[QUIZ_OFFER]` text marker)

```python
from langchain_core.tools import tool

@tool
def generate_quiz(topic: str, difficulty: str = "medium", num_questions: int = 5) -> dict:
    """
    Generate an interactive quiz for the student on the given topic.
    Call when the student has just finished learning a concept and is ready to be tested.
    difficulty: easy | medium | hard.
    """
    questions = generate_mcq_questions(topic, subject, key_stage, num_questions=num_questions)
    return {"topic": topic, "questions": questions, "action": "show_quiz"}

# Bind to the LLM for session chat:
llm_with_tools = get_llm(tools=[generate_quiz])

# When Gemini decides to call it:
response = llm_with_tools.invoke(messages)
if response.tool_calls:
    for tc in response.tool_calls:
        result = generate_quiz.invoke(tc["args"])   # executes with typed params
        # inject result back → Gemini continues streaming
```

**Before:** Gemini outputs `[QUIZ_OFFER: topic="..."]` as a string. Frontend regex-parses it. Gemini has no idea what happened.  
**After:** Gemini calls `generate_quiz(topic="photosynthesis", difficulty="medium", num_questions=5)`. Typed, explicit, result is injected back.

Keep the `[QUIZ_OFFER]` regex parser in `SessionPage.tsx` for the first deploy; remove after confirming tool-based quiz works end-to-end.

#### 1e. Message builder — `_build_lc_messages()` (replaces `_build_contents()`)

```python
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

def _build_lc_messages(history, user_message, rag_chunks=None, system_prompt=None):
    messages = []
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    for msg in history:
        cls = HumanMessage if msg["role"] == "user" else AIMessage
        messages.append(cls(content=msg["content"]))
    rag_prefix = _format_rag_context(rag_chunks) + "\n\n" if rag_chunks else ""
    messages.append(HumanMessage(content=rag_prefix + user_message))
    return messages
```

#### 1f. Gemini Built-in Tools (bonus — zero extra code to wire up)

LangChain exposes two Gemini-native built-in tools that run inside Gemini's own infrastructure:

| Tool | What it does | Use case in SmartAI Tutor |
|---|---|---|
| `GoogleSearchRetrieval` | Grounds responses in real-time web results | Current-events topics, recent science news, PSHE |
| `code_execution` | Gemini generates and runs Python code in a sandbox, returns actual output | GCSE Computer Science — live code execution during lessons |

```python
from langchain_google_genai import GoogleSearchRetrieval
from langchain_google_genai.tool_types import Tool as GeminiTool

llm_with_search = get_llm(tools=[
    generate_quiz,
    GoogleSearchRetrieval(),
    GeminiTool(code_execution={}),
])
```

#### 1g. LangGraph for production tool loops (recommended path)

For the multi-step cycle (stream → detect tool call → execute → inject result → resume stream), **LangGraph** is the 2025 production recommendation over a manual `while True` loop. It provides typed state, per-node error handling, and easier observability.

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(model=llm_with_tools, tools=[generate_quiz])

async for chunk in agent.astream({"messages": messages}):
    if "agent" in chunk:
        for msg in chunk["agent"]["messages"]:
            if msg.content:
                yield msg.content
```

For the initial integration a manual loop is sufficient. Migrate to LangGraph when tool count grows beyond 3.

---

### Part 2 — Kokoro TTS

Replaces `gemini-2.5-flash-preview-tts` (billed API, ~500ms–1.5s, American accent) with Kokoro-82M (free, local, ~280ms, British English). Only `text_to_speech()` in `voice_service.py` changes.

#### Current vs after

| | Gemini TTS (current) | Kokoro (after) |
|---|---|---|
| Latency | ~500ms–1.5s network round-trip | ~280ms CPU inference |
| Cost | Billed per character | £0 — runs on your server |
| Accent | American-neutral | British English (`bf_emma`) |
| Availability | Google quota dependent | No quota, always available |
| First audio | After full response | After first sentence (with streaming) |

#### Implementation — `voice_service.py`

```python
# pip install kokoro soundfile
from kokoro import KPipeline
import numpy as np, soundfile as sf, io

_kokoro: KPipeline | None = None

def _get_kokoro() -> KPipeline:
    global _kokoro
    if _kokoro is None:
        _kokoro = KPipeline(lang_code="b")   # "b" = British English
    return _kokoro

def text_to_speech(text: str, lang: str = "en") -> tuple[bytes, str]:
    clean = text.strip()
    if not clean or clean.startswith("[Error"):
        raise ValueError("Cannot generate speech for empty or error text")
    chunks = [audio for _, _, audio in _get_kokoro()(clean, voice="bf_emma")]
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(chunks).astype(np.float32), samplerate=24000, format="WAV")
    return buf.getvalue(), "audio/wav"   # same return type as before — no callers change
```

`speech_to_text()` and `voice_converse()` in `voice_service.py` are **unchanged**.

#### Pre-warm in `main.py`

Kokoro loads a ~300MB model on first call. Pre-warm on startup to avoid a 2–3s cold start on the first voice request:

```python
# main.py lifespan
from app.services.voice_service import _get_kokoro
await asyncio.to_thread(_get_kokoro)
```

#### Voice names

| Voice ID | Type | `lang_code` |
|---|---|---|
| `bf_emma` | British female | `"b"` — use this, natural for UK GCSE |
| `bf_isabella` | British female | `"b"` — slightly brighter alternative |
| `bm_george` | British male | `"b"` — teacher-persona option |

**Critical:** `lang_code` and voice prefix must match. `bf_*` / `bm_*` require `lang_code="b"`. Using `"a"` with a British voice produces garbled output.

---

### What Good It Brings

| Current problem | After | Benefit |
|---|---|---|
| `stream_response_async` blocks event loop (fake async) | Native `astream()` — event loop stays free | Concurrent sessions stop degrading each other |
| `_repair_json` + `_extract_json_array` crash in prod | `.with_structured_output(List[MCQQuestion])` — always valid | Eliminates MCQ `JSONDecodeError`; ~60 lines of fragile code deleted |
| `[QUIZ_OFFER]` text marker — Gemini has no typed params | `generate_quiz(@tool)` — Gemini calls with `topic, difficulty, count` | Parameterised, explicit, Gemini knows what happened |
| `_call_with_retry()` — 30 lines of manual backoff | `max_retries=5` on `ChatGoogleGenerativeAI` | Tested LangChain logic replaces custom code |
| Gemini TTS: ~500ms–1.5s, billed per character | Kokoro: ~280ms local, £0 per character | Faster voice, eliminates cost, no quota |
| American-neutral TTS voice | British English `bf_emma` | Appropriate for UK GCSE students |
| `_build_contents()` — Gemini SDK types, vendor lock-in | `_build_lc_messages()` — standard LangChain messages | Can swap Gemini for any LLM without rewriting callers |

---

### Dependencies

```
# Backend requirements.txt additions:
langchain>=0.3.0
langchain-core>=0.3.0
langchain-google-genai>=4.0.0    # MUST be >=4.0.0 — 2.x has stale bind_tools()
kokoro>=0.9.2
soundfile>=0.12.1
```

---

### Implementation Order (12 steps)

1. `requirements.txt` — add LangChain + Kokoro + soundfile deps
2. `services/llm_service.py` — create `get_llm()` factory, `ChatGoogleGenerativeAI` singleton
3. `services/gemini_service.py` — write `_build_lc_messages()` alongside old `_build_contents()`
4. `services/gemini_service.py` — rewrite `stream_response_async()` to use `get_llm().astream()`
5. `services/gemini_service.py` — add `MCQQuestion` Pydantic model; rewrite `generate_mcq_questions()` with `.with_structured_output()`
6. `services/gemini_service.py` — delete `_repair_json`, `_extract_json_array`, `_call_with_retry`, `_build_contents`, `_get_client`; replace remaining `client.models.generate_content` calls with `get_llm().invoke()`
7. `services/gemini_service.py` — add `generate_quiz @tool`; bind to LLM for session use
8. `services/voice_service.py` — replace `text_to_speech()` with Kokoro implementation
9. `main.py` — add `await asyncio.to_thread(_get_kokoro)` in lifespan startup
10. Test locally — chat session stream, MCQ generation, quiz tool call, TTS voice
11. `[QUIZ_OFFER]` backward compat check — keep frontend regex parser until tool-based quiz confirmed working end-to-end in production
12. Docker rebuild — `docker compose build --no-cache backend`

---

### Gotchas

1. **`langchain-google-genai>=4.0.0`** — the 2.x line is stale; `bind_tools()` has known bugs with Gemini 2.5. Must be 4.0.0+.
2. **`with_structured_output` + `astream` cannot be combined** — quiz/report generation uses `.invoke()` (blocking, structured); main chat uses `.astream()` (streaming). Keep them on separate LLM call paths.
3. **Kokoro `lang_code` must match voice prefix** — `KPipeline(lang_code="b")` for `bf_*` / `bm_*` voices. Mismatch = garbled output, no error thrown.
4. **Kokoro cold start** — ~300MB model, 2–3s load time. Pre-warm in `main.py` lifespan or first voice request will be slow.
5. **Tool context** — `@tool` functions need `db`, `student_id`, `appointment_id` from session context. Pass via closure or `ToolContext` dataclass, never as tool parameters (Gemini must not be able to specify student IDs).
6. **`soundfile` WAV** — Kokoro returns `float32` numpy arrays at 24kHz. The existing `_pcm_to_wav()` helper in `voice_service.py` is no longer needed once Kokoro is in place.
