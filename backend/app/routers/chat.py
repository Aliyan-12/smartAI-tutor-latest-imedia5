import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db, async_session_factory
from app.middleware.auth import get_current_user
from app.core.security import decode_access_token
from app.models.user import User, ROLE_STUDENT
from app.schemas.chat import MessageCreate, ChatResponse, ChatListItem, MessageResponse, QuizFeedbackRequest
from app.services import chat_service, gemini_service, platform_service, session_agent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _ensure_student(user: User):
    if user.role != ROLE_STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can use the chat feature",
        )


async def _ensure_credits(db: AsyncSession, user: User):
    if not user.has_credits:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please subscribe to continue.",
        )


@router.get("/list", response_model=List[ChatListItem])
async def list_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    chats = await chat_service.get_user_chats(db, current_user.id)
    return [
        ChatListItem(id=c.id, session_id=c.session_id, title=c.title, created_at=c.created_at)
        for c in chats
    ]


@router.get("/credits")
async def get_credits(
    current_user: User = Depends(get_current_user),
):
    return {
        "credits": float(current_user.credits),
        "cost_per_message": platform_service.COST_PER_MESSAGE,
    }


@router.get("/{session_id}", response_model=ChatResponse)
async def get_chat(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    chat = await chat_service.get_chat_by_session(db, session_id, current_user.id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return ChatResponse.model_validate(chat)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    deleted = await chat_service.delete_chat_by_session(db, session_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")


@router.post("/for-appointment/{appointment_id}")
async def get_or_create_session_chat(
    appointment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)

    from app.models.chat import Chat as ChatModel
    from sqlalchemy import select as sa_select

    # The session chat title is a stable key used to find the right chat later
    session_title_key = f"[session:{appointment_id}]"

    # Look up by stable title key + user — no migration dependency
    result = await db.execute(
        sa_select(ChatModel)
        .options(selectinload(ChatModel.messages))
        .where(
            ChatModel.user_id == current_user.id,
            ChatModel.title.like(f"{session_title_key}%"),
        )
        .order_by(ChatModel.id.desc())
        .limit(1)
    )
    chat = result.scalar_one_or_none()

    if not chat:
        from app.services import appointment_service
        appt = await appointment_service.get_appointment(db, appointment_id)
        if not appt:
            raise HTTPException(status_code=404, detail="Appointment not found")

        logger.info(
            f"Session chat init: appt_id={appointment_id} "
            f"appt.student_id={appt.student_id} current_user.id={current_user.id}"
        )

        if appt.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="This appointment does not belong to you")

        display_title = appt.title or f"{appt.subject} Session"
        full_title = f"{session_title_key} {display_title}"
        chat = await chat_service.create_chat(db, current_user.id, title=full_title)

        # Also try to set appointment_id FK if the column exists (non-fatal)
        try:
            chat.appointment_id = appointment_id
        except Exception:
            pass

        await db.commit()
        await db.refresh(chat)

        # Reload with messages
        result2 = await db.execute(
            sa_select(ChatModel)
            .options(selectinload(ChatModel.messages))
            .where(ChatModel.id == chat.id)
        )
        chat = result2.scalar_one()

    messages_out = [
        {
            "id": m.id,
            "chat_id": chat.id,
            "role": m.role,
            "content": m.content,
            "timestamp": m.timestamp.isoformat(),
        }
        for m in sorted(chat.messages, key=lambda m: m.timestamp)
    ]

    return {"session_id": chat.session_id, "messages": messages_out}


@router.post("/quiz-feedback")
async def quiz_feedback_stream(
    payload: QuizFeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Silently inject a quiz result into the AI's context and stream its feedback response.
    No user message is saved or shown — only the AI reply appears in chat.
    """
    _ensure_student(current_user)

    chat = await chat_service.get_chat_by_session(db, payload.session_id, current_user.id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    history, rag_chunks = await chat_service.build_context(db, chat.id)

    import re as _re
    _appt_id: int | None = getattr(chat, "appointment_id", None)
    if not _appt_id and chat.title:
        _m = _re.match(r"\[session:(\d+)\]", chat.title)
        if _m:
            _appt_id = int(_m.group(1))

    session_system_prompt: str | None = None
    if _appt_id:
        try:
            session_system_prompt = await session_agent_service.build_session_system_prompt(
                db, _appt_id, current_user.id, history_len=len(history)
            )
        except Exception:
            pass

    weak_str = ", ".join(payload.weak) if payload.weak else "none"
    strong_str = ", ".join(payload.strong) if payload.strong else "none"
    score_pct = round(payload.score, 1)

    if score_pct >= 80:
        tone = "Praise them enthusiastically — this is a great score!"
    elif score_pct >= 60:
        tone = "Acknowledge the effort, highlight strengths, gently note the areas to review."
    else:
        tone = "Be warm and encouraging — do not make them feel bad. Focus first on what they got right, then guide them through the weak areas clearly."

    quiz_ctx = (
        f"[QUIZ COMPLETED]\n"
        f"Topic: {payload.topic} | Score: {score_pct}%\n"
        f"Strong areas: {strong_str}\n"
        f"Weak areas: {weak_str}\n"
        f"Tone guidance: {tone}\n"
        "Respond naturally — give brief, warm feedback on the quiz result, then continue teaching."
    )

    async def event_stream():
        full_response = []
        yield f"data: {json.dumps({'type': 'start', 'session_id': chat.session_id})}\n\n"

        async for token in gemini_service.stream_response_async(
            history,
            quiz_ctx,
            rag_chunks=rag_chunks,
            system_prompt_override=session_system_prompt,
        ):
            full_response.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        complete_text = "".join(full_response)
        if complete_text and not complete_text.startswith("[Error"):
            async with async_session_factory() as save_session:
                await chat_service.add_message(save_session, chat.id, "assistant", complete_text)
                await save_session.commit()

        yield f"data: {json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/stream")
async def stream_message(
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    # await _ensure_credits(db, current_user)

    # Intercept the lesson auto-start trigger — don't persist it as a user message
    is_lesson_start = payload.message.strip() == "__LESSON_START__"
    if is_lesson_start:
        # Internal instruction sent to the AI — never saved to DB or shown in chat
        lesson_start_instruction = (
            "BEGIN_LESSON: Start the lesson right now. "
            "Do NOT greet or ask what the student wants. "
            "Jump immediately into the CONNECT phase: recall prior knowledge, set the lesson goal, and make it engaging. "
            "Follow the full lesson structure: Connect → Teach → Practice → Apply → Reflect."
        )

    if payload.session_id:
        chat = await chat_service.get_chat_by_session(db, payload.session_id, current_user.id)
        if not chat:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    else:
        chat = await chat_service.create_chat(db, current_user.id)

    # Only save the user message if this is NOT the hidden lesson auto-start trigger
    if not is_lesson_start:
        await chat_service.add_message(db, chat.id, "user", payload.message)
    history, rag_chunks = await chat_service.build_context(db, chat.id, user_query=payload.message)

    # Resolve appointment_id: prefer the FK column, fall back to parsing the chat title
    # (title format: "[session:<id>] <display title>" set by get_or_create_session_chat)
    import re as _re
    _appt_id: int | None = getattr(chat, "appointment_id", None)
    if not _appt_id and chat.title:
        _m = _re.match(r"\[session:(\d+)\]", chat.title)
        if _m:
            _appt_id = int(_m.group(1))

    logger.info(
        f"Context built: history_msgs={len(history)}, "
        f"rag_chunks={len(rag_chunks) if rag_chunks else 0}, "
        f"is_session={_appt_id is not None}, appt_id={_appt_id}"
    )

    # Build a session-specific system prompt when this chat belongs to an appointment
    # history already includes the new user message so subtract 1 for the history_len
    session_system_prompt: str | None = None
    if _appt_id:
        try:
            session_system_prompt = await session_agent_service.build_session_system_prompt(
                db, _appt_id, current_user.id,
                history_len=max(0, len(history) - 1),
            )
        except Exception:
            logger.warning(
                f"Failed to build session prompt for appointment {_appt_id}, using default"
            )

    is_session = _appt_id is not None

    # Load student learning preferences for non-session chats (session prompt already includes them)
    student_prefs: dict | None = None
    if not session_system_prompt:
        try:
            from app.services.platform_service import get_student_settings
            _profile = await get_student_settings(db, current_user.id)
            student_prefs = {
                "teaching_pace": _profile.teaching_pace,
                "learning_style": _profile.learning_style or [],
                "teaching_preferences": _profile.teaching_preferences or {},
                "interests": _profile.interests or [],
                "learning_goals": _profile.learning_goals,
            }
        except Exception:
            pass

    # For non-session (simple) chats, use the simple prompt which has no quiz/slide markers
    if not is_session:
        from app.services.gemini_service import SIMPLE_CHAT_SYSTEM_PROMPT, build_personalised_system_prompt as _build_prompt
        if student_prefs:
            session_system_prompt = _build_prompt(student_prefs, base_prompt=SIMPLE_CHAT_SYSTEM_PROMPT)
        else:
            session_system_prompt = SIMPLE_CHAT_SYSTEM_PROMPT

    # Build ToolContext for session chats so Gemini can call session tools
    tool_context = None
    if is_session and _appt_id:
        try:
            from app.services.appointment_service import get_appointment
            from app.tools.session_tools import ToolContext
            appt = await get_appointment(db, _appt_id)
            if appt:
                tool_context = ToolContext(
                    db=db,
                    student_id=current_user.id,
                    appointment_id=_appt_id,
                    subject=appt.subject,
                    key_stage=appt.key_stage,
                    chat_session_id=chat.session_id,
                )
                logger.info(
                    f"ToolContext built: appt_id={_appt_id}, student_id={current_user.id}, "
                    f"subject={appt.subject}, key_stage={appt.key_stage}"
                )
        except Exception:
            logger.warning(f"Could not build ToolContext for appointment {_appt_id}")

    # Augment the user message with a research instruction when deep research is requested.
    # The actual retrieval happens inside the deep_research session tool, but for non-session
    # chats (no tool_context) we prepend a prompt directive so the LLM knows to be thorough.
    _effective_message = payload.message
    if payload.research and not is_lesson_start:
        _effective_message = (
            "[DEEP RESEARCH REQUEST] Please conduct a thorough, multi-faceted investigation "
            "into the following topic, covering key concepts, common misconceptions, real-world "
            "applications, and exam-relevant facts with clear sections:\n\n"
            + payload.message
        )

    async def event_stream():
        full_response = []
        yield f"data: {json.dumps({'type': 'start', 'session_id': chat.session_id})}\n\n"

        # Use the internal lesson instruction as the AI prompt when auto-starting a lesson;
        # for a lesson start the history has no user message appended so pass it as-is.
        _ai_user_content = lesson_start_instruction if is_lesson_start else _effective_message
        _history_slice = history if is_lesson_start else history[:-1]

        # For non-session chats with web_search=True, bind GoogleSearchRetrieval grounding
        # directly onto the LLM for this request. session chats use the web_search tool instead.
        _stream_kwargs: dict = dict(
            rag_chunks=rag_chunks,
            student_preferences=student_prefs,
            system_prompt_override=session_system_prompt,
            tool_context=tool_context,
            image_data=payload.image_data,
            image_mime=payload.image_mime or "image/jpeg",
        )

        if payload.web_search and not is_session:
            # Inject a search-aware system prompt addendum for simple (non-session) chats
            _search_note = (
                "\n\nWEB SEARCH ENABLED: You have access to current web information. "
                "Where relevant, incorporate up-to-date facts, recent developments, and "
                "verified statistics in your answer. Clearly note when information is recent."
            )
            _stream_kwargs["system_prompt_override"] = (
                (session_system_prompt or "") + _search_note
            )

        async for token in gemini_service.stream_response_async(
            _history_slice,
            _ai_user_content,
            **_stream_kwargs,
        ):
            # Ensure token is always a string (LangChain can yield lists on multi-part content)
            if not isinstance(token, str):
                token = "".join(
                    p.get("text", "") if isinstance(p, dict) else str(p)
                    for p in token
                ) if isinstance(token, list) else str(token)
            # Intercept tool-result tokens — emit as special SSE events, skip DB storage
            stripped = token.strip()
            if stripped.startswith("[TOOL_RESULT:") and stripped.endswith("]"):
                try:
                    inner = stripped[len("[TOOL_RESULT:"):-1]
                    tr = json.loads(inner)
                    logger.info(f"Tool result intercepted: tool={tr.get('tool')}, action={tr.get('data', {}).get('action')}")
                    if tr.get("tool") == "generate_quiz":
                        data = tr.get("data", {})
                        yield f"data: {json.dumps({'type': 'quiz_offer', 'content': data.get('topic', ''), 'assessment_id': data.get('assessment_id'), 'questions': data.get('questions', [])})}\n\n"
                    yield f"data: {json.dumps({'type': 'tool_result', 'tool': tr.get('tool', ''), 'data': tr.get('data', {})})}\n\n"
                except Exception:
                    pass
                continue  # Do NOT add tool-result tokens to full_response
            full_response.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        complete_text = "".join(full_response)

        # Strip any stray text markers from saved text (tools now handle quiz/slides)
        clean_text = complete_text.replace("[SLIDE_TRIGGER]", "").strip()

        if "[Error:" in clean_text:
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
            return

        async with async_session_factory() as save_session:
            await chat_service.add_message(save_session, chat.id, "assistant", clean_text)

            from app.services.user_service import get_user_by_id
            fresh_user = await get_user_by_id(save_session, current_user.id)
            if fresh_user:
                await platform_service.check_and_deduct_credit(save_session, fresh_user)
                yield f"data: {json.dumps({'type': 'credits', 'content': str(float(fresh_user.credits))})}\n\n"
                try:
                    await platform_service.award_xp(save_session, current_user.id, 5, "chat_message")
                    await platform_service.check_and_update_streak(save_session, current_user.id)
                except Exception:
                    pass

            title_to_yield: str | None = None
            if chat.title == "New Chat":
                saved_chat = await chat_service.get_chat_by_session(save_session, chat.session_id, current_user.id)
                if saved_chat:
                    title_to_yield = gemini_service.generate_chat_title(payload.message)
                    await chat_service.update_chat_title(save_session, saved_chat, title_to_yield)

            await save_session.commit()

            if title_to_yield:
                yield f"data: {json.dumps({'type': 'title', 'content': title_to_yield})}\n\n"

        yield f"data: {json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    """Simple-chat WebSocket (text + voice). Thin transport; all logic in chat_service."""
    await chat_service.run_chat_ws(websocket)
