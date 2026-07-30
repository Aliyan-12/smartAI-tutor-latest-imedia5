"""
agent_crew — the multi-agent tutoring pipeline (Pass 1 of the multi-agent redesign).

The single lesson agent overfits: one giant prompt + every tool + no memory of what it
covered, so it repeats itself, re-asks questions and re-wraps-up mid-lesson. This package
replaces it with NARROW, phase-specialised agents that hand off through a shared coverage
ledger:

    Navigator (deterministic phase router) picks ONE active agent per student turn:
        recap    → Intro/Recap   (brief reconnection, not the main teaching)
        teach    → Teacher       (slide-by-slide, visuals, records what it taught)
        practice → Practitioner  (drills what the Teacher taught, one question at a time)
        quiz     → Practitioner  (sets the ONE quiz in the quiz window)
        review   → Summarizer    (the ONLY agent allowed to close the lesson)

`roles.py` (this layer) is framework-agnostic plain data — role/goal/backstory + scoped
tool groups + a per-turn task builder. The crewai-specific construction (Agent/LLM/Crew +
streaming) lives in the runner layer, added after the integration spike proves out.
"""
