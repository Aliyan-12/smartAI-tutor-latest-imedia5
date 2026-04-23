"""
Voice Agent Service — business logic for the Gemini Live voice session.

Handles: system prompt assembly, connection-time RAG, history seeding,
tool call processing, turn-complete DB persistence, per-turn RAG injection.
The voice WebSocket router is kept as pure transport glue and delegates
all intelligence here.
"""
import logging
from typing import Callable, Awaitable

from google.genai import types

from app.db.session import async_session_factory
from app.services import chat_service, credit_service, retrieval_service
from app.services import session_agent_service
from app.services.gemini_service import SYSTEM_PROMPT, generate_chat_title

logger = logging.getLogger(__name__)

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

_OFFER_QUIZ_FN = types.FunctionDeclaration(
    name="offer_quiz",
    description=(
        "Offer the student an interactive multiple-choice quiz on a specific topic. "
        "Call this after fully explaining a concept to test understanding. "
        "After calling this tool say: 'I have prepared a quiz for you — check the Test tab!'"
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "topic": types.Schema(
                type=types.Type.STRING,
                description="Specific topic name to quiz on, e.g. 'Cell Structure', 'Photosynthesis'",
            )
        },
        required=["topic"],
    ),
)

SendFn = Callable[[dict], Awaitable[None]]


async def fetch_session_rag(appointment_id: int, subject: str, key_stage: str) -> str:
    """Connection-time RAG: fetch vectorised KB chunks for the session's assigned topics."""
    try:
        from app.models.appointment import Appointment
        from sqlalchemy import select

        async with async_session_factory() as db:
            result = await db.execute(select(Appointment).where(Appointment.id == appointment_id))
            appt = result.scalar_one_or_none()
            if not appt:
                return ""
            unit_names = session_agent_service._parse_unit_names(appt.description or "")
            if not unit_names:
                return ""
            return await session_agent_service._fetch_unit_kb_content_rag(
                db, unit_names, subject, key_stage,
                top_k_per_unit=5, max_chars=3500,
            )
    except Exception as e:
        logger.warning(f"Session RAG fetch failed: {e}")
        return ""


async def build_voice_system_prompt(
    appointment_id: int | None,
    user_id: int,
) -> tuple[str, str, str]:
    """
    Assemble the full voice-session system prompt.
    Returns (system_text, appt_subject, appt_key_stage).
    Includes connection-time KB injection and voice behavioural rules.
    """
    appt_subject = ""
    appt_key_stage = ""

    if appointment_id:
        try:
            async with async_session_factory() as db:
                system_text = await session_agent_service.build_session_system_prompt(
                    db, appointment_id, user_id
                )

            from app.models.appointment import Appointment
            from sqlalchemy import select

            async with async_session_factory() as db:
                result = await db.execute(
                    select(Appointment).where(Appointment.id == appointment_id)
                )
                appt = result.scalar_one_or_none()
                if appt:
                    appt_subject = appt.subject or ""
                    appt_key_stage = appt.key_stage or ""
        except Exception as e:
            logger.warning(f"Failed to build session voice prompt: {e}")
            system_text = SYSTEM_PROMPT
    else:
        system_text = SYSTEM_PROMPT

    # Inject connection-time KB content into system prompt
    if appointment_id and appt_subject:
        rag_kb = await fetch_session_rag(appointment_id, appt_subject, appt_key_stage)
        if rag_kb:
            system_text += (
                "\n\n[ASSIGNED CURRICULUM — use as PRIMARY knowledge source for all explanations and quizzes]\n"
                + rag_kb
                + "\n[END CURRICULUM]"
            )
            logger.info(
                f"Voice: injected {len(rag_kb)} chars of KB into system prompt "
                f"for appointment {appointment_id}"
            )

    system_text += (
        "\n\nVOICE SESSION RULES:\n"
        "- This is a real-time VOICE session. Speak naturally and concisely (under 90 s per response).\n"
        "- Stay strictly on topics from the [ASSIGNED CURRICULUM] above.\n"
        "- To offer a quiz, call the `offer_quiz` tool. Then say: "
        "'I have prepared a quiz for you — check the Test tab!'\n"
        "- Do NOT verbally ask quiz questions — the Test panel handles that automatically.\n"
        "- Between turns you may receive [RELEVANT CURRICULUM CONTEXT] blocks — treat them as "
        "additional reference material for your next response, not as user messages."
    )

    return system_text, appt_subject, appt_key_stage


def make_live_config(system_text: str) -> types.LiveConnectConfig:
    """Build Gemini Live configuration: audio modality, voice, transcription, quiz tool."""
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
            ),
        ),
        system_instruction=types.Content(parts=[types.Part(text=system_text)]),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=[types.Tool(function_declarations=[_OFFER_QUIZ_FN])],
    )


async def seed_chat_history(gemini_session, history: list[dict]) -> None:
    """Seed Gemini Live with the shared chat history so voice and text stay in sync."""
    if not history:
        return
    seed_turns = [
        types.Content(
            role="user" if msg["role"] == "user" else "model",
            parts=[types.Part(text=msg["content"])],
        )
        for msg in history[-20:]
    ]
    try:
        await gemini_session.send_client_content(turns=seed_turns, turn_complete=False)
        logger.info(f"Voice: seeded {len(seed_turns)} history messages into Gemini Live")
    except Exception as e:
        logger.warning(f"History seeding failed (non-fatal): {e}")


async def handle_tool_calls(tool_call, send_fn: SendFn) -> list:
    """
    Process Gemini Live tool calls. Sends quiz_offer WS events to the browser.
    Returns FunctionResponse list to forward back to Gemini.
    """
    fn_responses = []
    for fc in tool_call.function_calls:
        if fc.name == "offer_quiz":
            topic = (dict(fc.args) if fc.args else {}).get("topic", "")
            await send_fn({"type": "quiz_offer", "content": topic})
            logger.info(f"Voice: quiz offered via tool — topic='{topic}'")
            fn_responses.append(
                types.FunctionResponse(
                    id=fc.id,
                    name=fc.name,
                    response={"result": "Quiz sent to student Test tab"},
                )
            )
    return fn_responses


async def save_voice_turn(
    session_id: str,
    user_id: int,
    user_text: str,
    ai_text: str,
    send_fn: SendFn,
) -> tuple[str, int]:
    """
    Persist voice turn transcripts to the shared chat DB, deduct one credit,
    and auto-title the chat if needed.
    Returns (session_id, chat_id).
    """
    try:
        from app.services.user_service import get_user_by_id

        async with async_session_factory() as db:
            chat = await chat_service.get_chat_by_session(db, session_id, user_id)
            if not chat:
                chat = await chat_service.create_chat(db, user_id)
                session_id = chat.session_id
                await send_fn({"type": "session", "content": chat.session_id})

            if user_text:
                await chat_service.add_message(db, chat.id, "user", user_text)
            if ai_text:
                await chat_service.add_message(db, chat.id, "assistant", ai_text)

            fresh_user = await get_user_by_id(db, user_id)
            if fresh_user:
                await credit_service.check_and_deduct_credit(db, fresh_user)
                await send_fn({"type": "credits", "content": str(float(fresh_user.credits))})

            if chat.title == "New Chat" and user_text:
                title = generate_chat_title(user_text)
                await chat_service.update_chat_title(db, chat, title)
                await send_fn({"type": "title", "content": title})

            await db.commit()
            return session_id, chat.id
    except Exception as e:
        logger.error(f"Voice DB save error: {e}")
        return session_id, 0


async def inject_per_turn_rag(
    gemini_session,
    user_text: str,
    subject: str = "",
    key_stage: str = "",
) -> None:
    """
    Per-turn RAG: retrieve relevant KB chunks for the user's speech and inject
    them into Gemini Live before its next response so answers are curriculum-grounded.
    Works in both session voice (subject+key_stage filtered) and simple chat voice
    (unfiltered — searches the full KB).
    """
    try:
        async with async_session_factory() as db:
            rag_chunks = await retrieval_service.retrieve_relevant_chunks(
                db, user_text,
                subject=subject or None,
                key_stage=key_stage or None,
                top_k=4,
            )
        if rag_chunks:
            ctx = "\n".join(f"- {c.content[:350]}" for c in rag_chunks[:3])
            await gemini_session.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[types.Part(
                        text=f"[RELEVANT CURRICULUM CONTEXT for your next response:\n{ctx}\n]"
                    )],
                ),
                turn_complete=False,
            )
            logger.info(
                f"Voice: injected {len(rag_chunks)} RAG chunks for query '{user_text[:60]}'"
            )
    except Exception as e:
        logger.warning(f"Per-turn RAG injection failed (non-fatal): {e}")
