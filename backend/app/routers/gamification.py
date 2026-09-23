import logging

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_student, require_any_authenticated
from app.models.user import User
from app.schemas.gamification import (
    StudentProfileResponse,
    TopicMasteryResponse,
    DashboardResponse,
    DailyPlanResponse,
)
from app.services import platform_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gamification", tags=["gamification"])


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Return the full gamified dashboard for the authenticated student."""
    data = await platform_service.get_dashboard_data(db, current_user.id)

    mastery_list = [
        TopicMasteryResponse.model_validate(m) for m in data["mastery_overview"]
    ]

    daily_plan_raw = data["daily_plan"]
    daily_plan = DailyPlanResponse(
        weak_spots=daily_plan_raw["weak_spots"],
        spaced_review=daily_plan_raw["spaced_review"],
        confidence_boost=daily_plan_raw["confidence_boost"],
        upcoming_sessions=daily_plan_raw["upcoming_sessions"],
    )

    return DashboardResponse(
        profile=StudentProfileResponse.model_validate(data["profile"]),
        mastery_overview=mastery_list,
        daily_plan=daily_plan,
        continue_learning=data["continue_learning"],
        xp_to_next_level=data["xp_to_next_level"],
    )


@router.get("/profile", response_model=StudentProfileResponse)
async def get_profile(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Return the gamification profile for the authenticated student."""
    profile = await platform_service.get_or_create_profile(db, current_user.id)
    return StudentProfileResponse.model_validate(profile)


@router.get("/mastery", response_model=list[TopicMasteryResponse])
async def get_mastery(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Return all topic mastery records for the authenticated student."""
    mastery_list = await platform_service.get_mastery_overview(db, current_user.id)
    return [TopicMasteryResponse.model_validate(m) for m in mastery_list]


@router.get("/mastery-engine")
async def mastery_engine(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Evidence-based mastery: per-topic state + confidence + provenance, plus recommended
    next topics. Explainable (`based on N activities`) and versioned."""
    from app.services import mastery_service
    from app.services.mastery_algorithm import MASTERY_ALGORITHM_VERSION
    topics = await mastery_service.mastery_overview(db, current_user.id)
    recs = await mastery_service.recommend_next(db, current_user.id)
    await db.commit()
    return {
        "algorithm_version": MASTERY_ALGORITHM_VERSION,
        "topics": [{
            "subject": t.subject, "key_stage": t.key_stage, "topic": t.topic,
            "state": t.state, "performance": float(t.performance or 0),
            "confidence": float(t.confidence or 0), "evidence_count": t.evidence_count,
            "last_computed_at": t.last_computed_at,
        } for t in topics],
        "recommendations": recs,
    }


@router.get("/mastery-engine/topic")
async def mastery_topic_breakdown(
    subject: str,
    topic: str,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """'Why this score?' — the evidence and weighting behind a topic's mastery."""
    from app.services import mastery_service
    result = await mastery_service.topic_breakdown(db, current_user.id, subject, topic)
    await db.commit()
    return result


@router.post("/mastery-engine/backfill")
async def mastery_backfill(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Seed the evidence store from the student's legacy score history (idempotent)."""
    from app.services import mastery_service
    created = await mastery_service.backfill_student(db, current_user)
    await db.commit()
    return {"evidence_created": created}


@router.get("/mastery/{student_id}", response_model=list[TopicMasteryResponse])
async def get_mastery_for_student(
    student_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """
    Return all topic mastery records for a specific student.
    Accessible to teachers, parents, and admins for monitoring purposes.
    """
    mastery_list = await platform_service.get_mastery_overview(db, student_id)
    return [TopicMasteryResponse.model_validate(m) for m in mastery_list]


@router.post("/streak-check", response_model=StudentProfileResponse)
async def streak_check(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Check and update the daily login streak for the authenticated student."""
    profile = await platform_service.check_and_update_streak(db, current_user.id)
    return StudentProfileResponse.model_validate(profile)


@router.get("/next-topics")
async def get_next_topics(
    subject: Optional[str] = Query(default=None),
    key_stage: Optional[str] = Query(default=None),
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Return RAG-based topic recommendations for what to study next."""
    return await platform_service.get_next_topic_recommendations(
        db, current_user.id, subject=subject, key_stage=key_stage
    )
