# SmartAI Tutor — Multi-Agent Redesign Plan

> Status: **APPROVED (decisions locked 2026-07-29).** Implementing Pass 1.
>
> **Update (2026-07-29, second round of direction):**
> - **Crew runs in EVERY session** — no `use_crew_pipeline` flag (removed). Layering is
>   **LangChain (orchestrates main agent + navigator) → CrewAI (runs the session agents) →
>   Gemini → response**. The Navigator reinforces any agent that drifts out of scope.
> - **Tool-refusing logic REMOVED** (slide-move guard, answer-slide gate, one-visual-per-reply
>   refusal). Align the AI instead: it picks the best tool, shows one thing, and its words match
>   the screen — no "I've put a puzzle" with no puzzle. It's the AI that must be intelligent, not
>   the system.
> - **One student message → one coherent response.** The tap-to-answer chips (quick_replies) come
>   as PART of the agent's own turn — no separate recovery request. Removed the safety-net second
>   passes. New `interact` tool group makes quick_replies available to every agent.
> - **New slide tool `jump_to_slide(slide_index)`** (jump within the current deck; more later).
> - **AI authors puzzle params incl. LaTeX**; the system renders as-is (KaTeX validate→fix→retry).
>
> **Locked decisions:**
> - **A — CrewAI:** use the **official `crewai` package** and its **built-in streaming**
>   (`LLM(..., stream=True)` + `LLMStreamChunkEvent` listeners). NOT the in-house option.
> - **B — Session file:** `agent/session/` **package** with a flat re-exported public API.
> - **C — Order:** agent redesign FIRST (Pass 1), service reorg LAST (Pass 3).
> - **D — LaTeX:** **REMOVE** `clean_math_latex`/`_repair_*`. Instead the AI emits LaTeX as a
>   real KaTeX response part; on a KaTeX **render error** the frontend reports it back and the AI
>   re-emits a corrected version — the student only ever sees a clean render (validate→fix→retry,
>   no regex repair).
> - **E — Scope of first pass:** Pass 1 only = ledger + agents + navigator + per-agent
>   prompts/tools + Practitioner reads Teacher's ledger. Validate on a live session BEFORE
>   Pass 2 (streaming/cleanup) and Pass 3 (reorg).
> Goal: replace the single overfitted lesson agent with a narrow, phase-specialised
> multi-agent pipeline; make the tutor think → use the right tool → stream once (with TTS);
> reorganise services. Lesson structure + per-phase timings stay the same.

---

## 1. Diagnosis — confirmed in the real DB, not assumed

A real KS1 place-value session (chat 42-ish, local DB) shows every symptom you described:

- **Compulsive re-wrap-up.** *"You have done an amazing job today. We've learned all about tens
  and ones…"* appears **6+ times mid-lesson**. The single agent treats almost every turn as a
  closing turn.
- **Endless "let's try one more."** No sense that a concept is *done*; it loops on place-value
  build questions (32, 47, 35, 72…) forever.
- **No coverage memory.** It re-asks near-identical questions and re-explains what it already
  taught, because nothing records "this was covered."
- **Turn pile-up.** Several consecutive `assistant` messages (safety-net + forced recoveries
  stacking) — the band-aids fighting each other.

**Root cause:** ONE agent holds the whole lesson — every phase, every tool (34 bound at once),
one giant system prompt. It overfits to its own last output and to the highest-probability
"nice closing paragraph," and it has no structured record of what happened. Dedup / reasoning-leak
regex / forced-recovery turns are all band-aids on this single failure.

**The cure is structural:** per turn, run ONE small specialist agent with a narrow prompt, only
its phase's tools, and a shared ledger of what's been covered. That is what this plan builds.

---

## 2. Guiding principles

1. **Narrow beats broad.** Each turn, the model sees one role's prompt + one role's tools, not all.
2. **Memory, not dedup.** A structured *coverage ledger* (slides taught, questions asked, quiz
   done) replaces fuzzy sentence-dedup. The model doesn't repeat because it can SEE what's done.
3. **Tool-first, then speak once.** think → (if needed) call the most relevant tool → stream the
   single response. No pre-tool preamble, so nothing to de-duplicate.
4. **Stream live + TTS together.** No round buffering; text tokens and per-sentence TTS start as
   the model generates (~1–2 s), not after the whole answer exists.
5. **Keep security boundaries; drop cosmetic band-aids** (see §9 — this distinction is critical).
6. **Timings + phase structure unchanged** (the `_PHASE_BUDGET` you tuned stays).

---

## 3. Target architecture

```
                    ┌─────────────────────────────────────────────┐
                    │  NAVIGATOR  (deterministic phase router +     │
                    │  time budget + escalation/correction)         │
                    │  - maps lesson clock/phase → active agent     │
                    │  - owns the COVERAGE LEDGER (shared memory)   │
                    │  - can override a stuck sub-agent             │
                    └───────────────┬─────────────────────────────┘
        selects ONE active agent per student turn, by phase + clock
     ┌───────────────┬──────────────┴───────────────┬───────────────┐
     ▼               ▼                               ▼               ▼
 INTRO/RECAP      TEACHER                       PRACTITIONER      SUMMARIZER
 (recap phase)    (teach phase)                 (practice+quiz)   (review phase)
 - brief recall   - slides + deck map           - all puzzles     - concise recap
   of last topic  - animate/svg/mermaid/image   - manipulatives   - report card
 - NOT main       - "teach slide N, then ask"   - graph           - next-steps
   focus          - reads deck map to jump to   - reads TEACHER's   recommendations
 - scales by KS     the right slide/concept       ledger to drill
   (KS1 longer)                                   what was taught
                                                 - sets quiz in
                                                   last ~5 min
```

- **One agent is "active" per turn.** The Navigator picks it from the phase (which already comes
  from `plan_blocks` + `_PHASE_BUDGET`). This is *deterministic* — no extra LLM call to route in
  the common case. The Navigator only invokes an LLM to *correct* a sub-agent that's off-track.
- **Each agent = its own system prompt + its own tool subset + the shared ledger.** This is the
  narrowing that stops overfitting.
- **Time per agent = time per phase**, already in `_PHASE_BUDGET`. Intro/Recap scales by KS
  (KS1 gets a longer recap, KS5 shorter — a small budget tweak).

---

## 4. CrewAI — honest fit assessment (please read before we commit)

**CrewAI is not installed, and a literal "crew per turn" is the wrong execution model here.**
CrewAI's `crew.kickoff()` runs a crew of agents to completion and returns a final result — built
for autonomous batch task-decomposition. A live tutoring **turn** is one student message → one
streamed response, many times per lesson. Running a full crew (with a hierarchical manager LLM
delegating) on every message would:

- **add latency** (extra manager/delegation LLM calls) — the opposite of your 3–4 s goal;
- **break streaming** — CrewAI doesn't stream tokens + per-sentence TTS the way the current
  custom LangChain loop does.

**SPIKE VERIFIED (crewai 1.15.8, on our stack):** streaming works via `akickoff`; tool calls
execute and fire side-effects; async+function-calling is fine (#4442 doesn't bite); crewai runs
tool `_run` on a WORKER thread so our async DB tools bridge to the WS loop via
`run_coroutine_threadsafe` (no deadlock); streamed TEXT is the clean answer with the TOOL_CALL
first — "think → tool → speak" is natural, so NO dedup/buffering needed. Needs the
`crewai[google-genai]` extra.

**Recommended integration (delivers your goal without the downsides):**

> Adopt the CrewAI **agent/role model** — define `Intro`, `Teacher`, `Practitioner`, `Summarizer`,
> `Navigator` as first-class agents (role, goal, backstory, scoped tools) — but **execute one
> active agent per turn through the existing streaming tool-loop**, not `crew.kickoff()`. The
> Navigator is a deterministic phase→agent router (LLM only for corrections).

Two ways to realise it, your call (**Decision A**):

- **A1 — CrewAI library, single-agent execution.** Install `crewai`, use its `Agent`/`Task`
  abstractions for definitions + the Navigator's correction decisions, but keep streaming on our
  loop. Pro: literally "CrewAI." Con: CrewAI pulls a heavy dep tree, and we bypass its executor
  for the streaming path anyway, so we use ~30% of the library.
- **A2 — In-house "crew" (recommended).** Implement the same agent/navigator pattern natively
  (an `Agent` dataclass = name + system-prompt builder + tool groups + memory view). Pro: full
  control of streaming + latency, no heavy dep, easy to test. Con: not the literal `crewai` pkg.

I recommend **A2** — it gives you every benefit you listed (specialisation, navigator, narrow
pipelines, no overfitting) with better latency and streaming, and we can name it a "crew" so the
mental model matches. If you specifically want the `crewai` package on the résumé/stack, A1.

---

## 5. Per-agent design

Each agent has: a **role prompt** (short, focused), a **tool group**, and a **memory view**.

| Agent | Active in phase | Tools bound (ONLY these) | Reads from ledger | Writes to ledger |
|---|---|---|---|---|
| **Intro/Recap** | recap | quick_replies, (read-only slide/deck map) | last session's topic + mastery | `recap_done` |
| **Teacher** | teach | slides (advance/retreat/show), deck map, animate_concept, draw_svg, svg_diagram, mermaid_diagram, explanatory_puzzle | deck map, slides taught so far | `slides_taught`, `concepts_taught`, `questions_asked` |
| **Practitioner** | practice, quiz | labelling/matching/math/graph/diagram_math/manipulative puzzles + evaluators; generate_quiz (last ~5 min only) | **Teacher's `concepts_taught` + `slides_taught` + slide RAG** | `puzzles_done`, `quiz_done`, mastery |
| **Summarizer** | review | generate_session_report, create_assignment | the whole ledger | `report_done` |
| **Navigator** | (always, meta) | can call any agent's tool to *correct*; owns timing | everything | phase transitions |

Key behaviours that fix the observed bugs:

- **Teacher teaches slide-by-slide from the deck map** (already built) and records each concept in
  the ledger. It never re-teaches a concept the ledger marks taught.
- **Practitioner is handed the Teacher's ledger** — it drills exactly what was taught, using the
  slide RAG content, and knows which questions were already asked (won't repeat). It sets the quiz
  once, in the quiz window, then hands to Summarizer.
- **Only the Summarizer wraps up.** The Teacher/Practitioner are *forbidden* closing language —
  that alone removes the "amazing job today" spam, because only one agent, once, at the end, is
  allowed to say it.
- **Navigator enforces progression.** When a phase's time is up (from `_PHASE_BUDGET`), it switches
  the active agent — the lesson can't get stuck in an endless "one more" loop because the
  Practitioner is time-boxed and the Navigator moves it on.

---

## 6. The Coverage Ledger — the real cure for repetition

A structured record in `LessonPlan.session_state["ledger"]` (JSONB, already the pattern):

```json
{
  "slides_taught": [1,2,3,5],
  "concepts_taught": ["tens and ones", "comparing two-digit numbers"],
  "questions_asked": ["build 32", "which is bigger 74 or 47", ...],
  "puzzles_done": ["place_value_counters:32", ...],
  "quiz_done": true,
  "recap_done": true,
  "report_done": false
}
```

- Injected into every agent's prompt as **"ALREADY COVERED — do NOT repeat"** (like the deck map
  is now). The model repeats today because it CAN'T see this; give it the list and it stops.
- Replaces the fuzzy `_dup` sentence-matching entirely (which you want gone). No sentence-similarity
  logic — the model simply doesn't re-ask what the ledger shows asked.
- Written by the tools themselves (a puzzle tool appends to `puzzles_done`, a slide move appends to
  `slides_taught`) — deterministic, not model-reported.

---

## 7. Streaming redesign (removes dedup + buffering)

- **Tool-first prompt (per agent):** "Never write answer text before a tool call. If you need a
  tool, call it first (silently), then respond once based on its result." A narrow agent with 4–6
  tools makes "the most relevant tool" an easy choice.
- **Live streaming:** yield tokens as generated (the reverted change, re-applied cleanly). Because
  tool-first means no pre-tool preamble, there is **no duplication to dedup** — remove `_dup`.
- **Retraction safety net (only if a preamble slips through):** the `[LIVE_DISCARD]` mechanism I
  built + verified (3/3 test cases) retracts any pre-tool text. This is *not* dedup logic — it's
  "text written before the tool doesn't count." Kept as a thin guarantee, not a matcher.
- **TTS simultaneous:** per-sentence TTS already fires inside `stream_segment`; with live
  streaming the first sentence + its audio start in ~1–2 s together.

---

## 8. Service reorganisation

**Requested target layout:**

```
services/
  agent/
    session_service.py     ← session_agent_service + session_resource_service +
                              session_state_service + voice_agent_service + lesson_service
    teacher_service.py     ← svg_diagram_service + manim_service + mermaid/latex helpers
                              (from puzzle_service) + explanatory-image logic
    practice_service.py    ← puzzle_service (puzzle builders/evaluators) +
                              manipulative_service + graph_service
  jobs/
    sync_service.py        ← resource_hub_client + resource_sync_service + any job service
  (unchanged: rag_service, image_gen_service, platform_service, assessment_service,
   appointment_service, curriculum_service, casbin/oauth/school/user, chat_service, llm_service)
```

**Size reality (Decision B):** merging the 5 session files = **~5,800 lines in one
`session_service.py`** (session_agent_service alone is 3,809). That's hard to navigate/test.
Two ways to honour "one session service":
- **B1 — literal single file** `agent/session_service.py` (~5.8k lines). Simple import story;
  painful to work in.
- **B2 — a `session` PACKAGE** `agent/session/` with `__init__.py` re-exporting a flat public API
  (`from app.services.agent.session import ...`), internally split (turn loop, resources, state,
  voice, plan). *Same import surface you asked for, maintainable internals.* **Recommended.**

**Progress (2026-07-29):** `jobs/sync_service` ✅ (merged + validated live — sync runs, Hub 200s),
`teacher_service` ✅ (svg_diagram + manim + mermaid/svg/animation builders), `practice_service` ✅
(manipulative + graph + puzzle builders/math/latex/eval/state/rotation). Old 5 files deleted, full
app import graph clean, app boots. REMAINING: the `session/` package (the 5 session files) —
highest-risk, deferred until the crew is validated live.

**puzzle_service split is the fiddly bit:** it currently mixes teaching (mermaid + latex repair)
and practice (puzzle builders + evaluators). The split cleanly separates:
- → `teacher_service`: `clean_mermaid`, `build_mermaid`, `build_svg_diagram`, `build_animation`,
  `build_explanatory`, the latex repair helpers used by teaching visuals.
- → `practice_service`: `build_math/labelling/matching/graph/diagram_math`, `evaluate`,
  `set_puzzle_shown`, the manipulative + graph builders.
- Shared tiny helpers (background pick, payload shaping) go to a `practice_service` internal.

This reorg is **mechanical but wide** — every import of these modules across `tools/`, `routers/`,
`services/` updates. Best done as its own commit *after* the agent redesign lands, to keep diffs
reviewable (**Decision C** — do the reorg first, or the agent redesign first? I recommend agent
redesign first on the current layout, reorg second, so behaviour and moves aren't tangled).

---

## 9. Code cleanup — band-aids OUT, security boundaries STAY

You asked to remove the "vars to ignore for latex / remove from chat" and align the AI instead.
Agreed **for the cosmetic band-aids**, but there is a hard line I will not cross silently:

**REMOVE (replace with narrow agents + prompting + ledger):**
- `_dup` fuzzy sentence dedup (→ coverage ledger).
- reasoning-leak regex `clean_reasoning_leak` / `_REASONING_SHAPE` (→ tool-first + narrow prompt
  so the model doesn't emit plans as prose; a leaked plan becomes rare and, if it happens, the
  agent prompt forbids it).
- the safety-net forced-recovery turns (→ Navigator handles progression; Practitioner always has
  puzzle tools bound, so no "invited practice with no puzzle" recovery needed).
- round buffering (→ live streaming).

**KEEP — these are security boundaries, not band-aids (removing them = XSS / RCE on a kids' app):**
- `svg_diagram_service.sanitize_svg` — allow-list parser for model-authored SVG. Model output is
  untrusted; this prevents `<script>`/handlers/external refs. **Cannot** be replaced by "align the
  AI" — a confused/adversarial model can emit malicious markup.
- `manim_service.validate_scene_code` + process isolation — model writes Python; this is the
  RCE sandbox. Non-negotiable.
- `clean_math_latex`/array-repair — this is not really "ignore vars," it's making the tutor's own
  maths render instead of shipping broken KaTeX to a student. I recommend KEEPING it (it's a
  correctness fix, cheap, and prompting won't make an LLM's LaTeX 100% valid). Open to your call
  (**Decision D**), but I'd keep it.

I will call out each var as I remove it so you can veto individually.

---

## 10. Phasing (so nothing breaks on a live system)

1. **Ledger + agent scaffolding** (no behaviour change yet): add the coverage ledger, the `Agent`
   abstraction, the Navigator phase→agent router. Keep the current single prompt as a fallback.
2. **Split the system prompt into per-agent prompts** + per-agent tool groups. Wire the Navigator
   to pick the agent by phase. Forbid closing language outside Summarizer. → kills the wrap-up spam.
3. **Practitioner reads Teacher's ledger + slide RAG.** → drilling builds on teaching, no repeats.
4. **Live streaming + remove dedup/buffering/leak-regex.** → speed + TTS + no dedup.
5. **Service reorganisation** (mechanical moves).
6. **Remove the safety-net recoveries** once the Navigator proves it handles progression.

Each step is independently shippable and testable; we can stop/评估 between them.

---

## 11. Risks & open decisions

**Risks**
- Multi-agent handoffs can drop context if the ledger is incomplete → the ledger schema must be
  written by tools deterministically, and every agent prompt must render it.
- Live streaming without dedup relies on tool-first compliance; the `[LIVE_DISCARD]` guard is the
  backstop. Needs a real-session smoke test.
- The service reorg is wide; do it as its own commit with a green test pass before/after.

**Decisions I need from you**
- **A. CrewAI:** A1 (install `crewai`, use its Agent model) or **A2 (in-house crew, recommended)**?
- **B. Session file:** B1 (one 5.8k-line file) or **B2 (a `session/` package, same import surface,
  recommended)**?
- **C. Order:** agent redesign first then reorg (recommended), or reorg first?
- **D. `clean_math_latex`:** keep (recommended — it's a correctness fix) or remove with the other
  band-aids?
- **E. Scope of this first implementation pass:** all of §10, or just steps 1–3 (the multi-agent
  core that fixes repetition) to validate before the streaming + reorg?
```
