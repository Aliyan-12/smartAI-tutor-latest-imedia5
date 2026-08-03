"""
agent_roles — the multi-agent tutoring pipeline (pure LangChain, role-per-turn).

The single lesson agent overfits: one giant prompt + every tool + no memory of what it
covered, so it repeats itself, re-asks questions and re-wraps-up mid-lesson. This package
replaces it with NARROW, phase-specialised roles that the session turn handler runs through
the native Gemini tool-calling path (`gemini_service.stream_response_async` via `core._consume`) —
real token streaming, the conversation passed as ACTUAL messages (history-aware), and tool
results routed to WS frames only. It talks to Gemini directly — no third-party agent-framework layer.

    Navigator (deterministic phase router) picks ONE active role per student turn:
        recap    → Teacher       (ONE brief welcome, then teaches — the Intro agent is merged in)
        teach    → Teacher       (slide-by-slide, visuals bound so a claim is always backed)
        practice → Practitioner  (drills what the Teacher taught, one question at a time)
        quiz     → Practitioner  (sets the ONE quiz in the quiz window)
        review   → Summarizer    (the ONLY role allowed to close the lesson + write the report)

`roles.py` is framework-agnostic plain data — role/goal/backstory (persona + remit + alignment)
+ scoped tool groups. `navigator.py` is a pure function over lesson state (no LLM call). The turn
handler in `app/services/agent/session/core.py` builds the role's system prompt (backstory + the
live session prompt/anchor) and binds the role's tool groups, then streams the turn.
"""
