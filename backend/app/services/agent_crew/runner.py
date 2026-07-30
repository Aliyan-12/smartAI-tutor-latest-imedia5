"""
runner.py — execute ONE tutoring turn through crewai and stream it to the WS.

The Navigator picks the single active agent for this turn (by lesson phase/clock). We build a
one-agent, one-task Crew for it — NOT a full 5-agent crew per turn, which would add manager/
delegation LLM calls and latency. Streaming is crewai-native (`Crew(stream=True).akickoff()`):

  • TEXT chunks  → the clean student answer (no reasoning leak) → SentenceSegmenter → stream_segment
                   (same text pump + per-sentence TTS the single-agent path uses).
  • TOOL_CALL    → the tool has ALREADY executed inside the crew (our adapter emitted the WS frame
                   + thinking label); nothing to stream, so we skip it.

Because Gemini emits the TOOL_CALL first and the tool runs before the text, "think → tool → speak"
falls out naturally — no dedup, no buffering, no preamble scrubbing.

Per-SESSION isolation: a fresh LLM + fresh Agent + fresh Crew every turn. crewai agents carry
state; sharing them across concurrent WS sessions corrupts context (a known crewai foot-gun).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, List, Optional

from app.services.agent_crew.roles import RoleSpec
from app.services.agent_crew.tools import ToolBridge, adapt_tools

logger = logging.getLogger(__name__)


def _is_tool_chunk(chunk: Any) -> bool:
    ct = str(getattr(chunk, "chunk_type", "") or "").upper()
    return ("TOOL" in ct) or bool(getattr(chunk, "tool_call", None))


def render_history(history: list, limit: int = 8) -> str:
    """Render the last `limit` turns of LangChain messages as plain Student/Tutor lines.
    crewai's single-task kickoff has no chat memory of its own, so we hand it the recent
    conversation explicitly (the [[coverage ledger]] carries the structured 'what's covered')."""
    out: List[str] = []
    for m in (history or [])[-limit:]:
        role = getattr(m, "type", "") or getattr(m, "role", "")
        content = (getattr(m, "content", "") or "").strip()
        if not content:
            continue
        if role in ("human", "user"):
            out.append(f"Student: {content}")
        elif role in ("ai", "assistant"):
            out.append(f"Tutor: {content}")
        # system/other → skipped (the persona + lesson context already carry it)
    return "\n".join(out)


def build_task_description(role: RoleSpec, lesson_context: str, history_block: str) -> str:
    """Assemble the per-turn Task text: the Navigator's scope reinforcement + the narrow directive
    + recent conversation + the full live lesson context (slide content, deck map, LESSON STATE
    anchor incl. the covered list)."""
    from app.services.agent_crew import navigator
    parts = []
    guard = navigator.reinforce(role)
    if guard:
        parts.append(guard)
    parts.append(f"YOUR JOB THIS TURN ({role.display}): {role.directive}")
    if history_block:
        parts.append("=== RECENT CONVERSATION ===\n" + history_block)
    parts.append("=== CURRENT LESSON STATE & ON-SCREEN CONTENT (authoritative — trust this) ===\n"
                 + lesson_context)
    return "\n\n".join(parts)


async def stream_crew_turn(
    *,
    send: Callable[[dict], Awaitable[None]],
    turn_id: str,
    tts: bool,
    role: RoleSpec,
    backstory: str,
    task_description: str,
    expected_output: str,
    lc_tools: list,
    emit_thinking: Callable[[str], Awaitable[None]],
    appt_id: Optional[int],
) -> tuple[List[str], dict]:
    """Run the active agent for one turn. Returns (streamed_sentences, signals).

    signals may contain: puzzle_shown, quick_replies_shown, ended_appt — read by _run_turn to
    drive the deferred report navigation etc.
    """
    from crewai import Agent, Task, Crew
    from app.services.agent_crew.llm import build_agent_llm
    from app.services.agent.session.core import SentenceSegmenter, stream_segment

    ws_loop = asyncio.get_running_loop()
    bridge = ToolBridge(send=send, ws_loop=ws_loop, emit_thinking=emit_thinking, appt_id=appt_id)
    crew_tools = adapt_tools(lc_tools, bridge)

    from app.core.config import settings
    _dbg = getattr(settings, "debug", False)
    if _dbg:
        logger.info("CREW TASK appt=%s role=%s ↓↓↓\n%s\n↑↑↑ end task", appt_id, role.name, task_description)

    segmenter = SentenceSegmenter()
    seq = 0
    full: List[str] = []

    async def _run_once() -> str:
        # THINK → ACT → SPEAK ONCE. crewai streams MANY text blocks per turn (its reasoning, drafts
        # and the final answer); streaming them all produced the doubled/garbled output. So we DRAIN
        # the stream to drive the turn to completion — tools still execute and their WS frames fire
        # live (the adapter emits them, not these chunks) — then use ONLY the single FINAL answer.
        # A FRESH agent + crew each attempt (crewai agents carry per-run state).
        _llm = build_agent_llm(stream=True)
        _agent = Agent(role=role.role, goal=role.goal, backstory=backstory,
                       llm=_llm, tools=crew_tools, verbose=False, allow_delegation=False)
        _task = Task(description=task_description, expected_output=expected_output, agent=_agent)
        _crew = Crew(agents=[_agent], tasks=[_task], stream=True, verbose=False)
        _streaming = await _crew.akickoff(inputs={})
        _chunks: List[str] = []
        async for chunk in _streaming:
            if _is_tool_chunk(chunk):
                continue
            c = getattr(chunk, "content", "") or ""
            if c:
                _chunks.append(c)
        _result = getattr(_streaming, "result", None)
        t = ""
        try:
            t = (getattr(_result, "raw", None) or "").strip()
        except Exception:  # noqa: BLE001
            t = ""
        if not t:
            t = (_chunks[-1] if _chunks else "").strip()
        return _strip_scaffolding(t)

    # Gemini intermittently returns an empty response and crewai raises "Invalid response from LLM".
    # Retry ONCE with a fresh crew before giving up (which would fall back to the single-agent path).
    text = ""
    for _attempt in range(2):
        try:
            text = await _run_once()
        except Exception:
            if _attempt == 1:
                logger.warning("CREW akickoff failed twice (appt=%s role=%s)", appt_id, role.name, exc_info=True)
                raise
            logger.warning("CREW retry after failed LLM response (appt=%s role=%s)", appt_id, role.name)
            continue
        if text.strip():
            break
        if _attempt == 0:
            logger.warning("CREW empty answer — retrying once (appt=%s role=%s)", appt_id, role.name)

    if _dbg:
        logger.info("CREW ANSWER appt=%s role=%s: %r", appt_id, role.name, text[:600])

    for sentence in segmenter.feed(text):
        if sentence.strip():
            await stream_segment(send, seq, sentence, tts=tts, turn_id=turn_id)
            full.append(sentence)
            seq += 1
    rem = segmenter.flush()
    if rem.strip():
        await stream_segment(send, seq, rem, tts=tts, turn_id=turn_id)
        full.append(rem)
        seq += 1

    logger.info("CREW turn done appt=%s role=%s sentences=%d signals=%s",
                appt_id, role.name, len(full), bridge.signals)
    return full, bridge.signals


def _strip_scaffolding(text: str) -> str:
    """Belt-and-suspenders: strip any ReAct scaffolding crewai might leave on the final answer
    ('Thought:' / 'Final Answer:' prefixes). The final answer is normally clean; this is a guard."""
    if not text:
        return text
    t = text.strip()
    for marker in ("Final Answer:", "final answer:", "FINAL ANSWER:"):
        idx = t.rfind(marker)
        if idx != -1:
            t = t[idx + len(marker):].strip()
            break
    return t
