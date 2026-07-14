"""
Database seed script.
Populates the database with initial data: admin, teacher, student, parent.
Links parent to student and generates invite code.

Usage:
    cd backend
    python -m app.seed
"""
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("seed")


SEED_USERS = [
    {
        "name": "Platform Administrator",
        "email": "administrator@smartai.com",
        "password": "administrator123",
        "role": "administrator",
        "credits": 0,
    },
    {
        "name": "Admin User",
        "email": "admin@smartai.com",
        "password": "admin123",
        "role": "admin",
        "credits": 0,
    },
    {
        "name": "Sarah Thompson",
        "email": "teacher@smartai.com",
        "password": "teacher123",
        "role": "teacher",
        "credits": 0,
    },
    {
        "name": "Alex Johnson",
        "email": "student@smartai.com",
        "password": "student123",
        "role": "student",
        "credits": 100,
    },
    {
        "name": "Patricia Williams",
        "email": "parent@smartai.com",
        "password": "parent123",
        "role": "parent",
        "credits": 0,
    },
]


async def _get_or_create_default_school(db):
    """Ensure the default 'individual_host' school exists. Every individual
    (parent/student) signup attaches to it."""
    from sqlalchemy import select
    from app.models.school import (
        School, DEFAULT_SCHOOL_NAME, DEFAULT_SCHOOL_SLUG, INDIVIDUAL_HOST,
    )

    existing = await db.execute(
        select(School).where(School.slug == DEFAULT_SCHOOL_SLUG)
    )
    school = existing.scalar_one_or_none()
    if school:
        return school
    school = School(
        name=DEFAULT_SCHOOL_NAME,
        slug=DEFAULT_SCHOOL_SLUG,
        country="United Kingdom & United Arab Emirates",
        account_type=INDIVIDUAL_HOST,
        is_default=True,
    )
    db.add(school)
    await db.flush()
    logger.info(f"Created default school: {school.name} (id={school.id})")
    return school


async def run_seed():
    from app.db.session import async_session_factory
    from app.services.user_service import get_user_by_email, create_user
    from app.models.parent_student import InviteCode
    from app.models.user import ACCOUNT_SCHOOL, ACCOUNT_INDIVIDUAL

    async with async_session_factory() as db:
        default_school = await _get_or_create_default_school(db)

        created_users = {}
        for user_data in SEED_USERS:
            existing = await get_user_by_email(db, user_data["email"])
            if existing:
                logger.info(f"User already exists: {user_data['email']} (skipping)")
                # Backfill tenant/onboarding fields for pre-existing seed users.
                existing.school_id = existing.school_id or default_school.id
                existing.is_verified = True
                existing.onboarding_completed = True
                existing.approval_status = "approved"
                created_users[user_data["role"]] = existing
                continue

            user = await create_user(
                db,
                name=user_data["name"],
                email=user_data["email"],
                password=user_data["password"],
                role=user_data["role"],
                credits=user_data["credits"],
            )
            # Seed accounts are pre-verified, onboarded, approved, and attached to the
            # default school. Admin + administrator are treated as school accounts.
            user.school_id = default_school.id
            user.is_verified = True
            user.onboarding_completed = True
            user.approval_status = "approved"
            user.account_type = ACCOUNT_SCHOOL if user.role in ("admin", "administrator") else ACCOUNT_INDIVIDUAL
            created_users[user_data["role"]] = user
            logger.info(f"Created {user.role}: {user.email}")

        # The platform admin owns the default school tenant.
        admin = created_users.get("admin")
        if admin and default_school.superadmin_user_id is None:
            default_school.superadmin_user_id = admin.id

        # Link parent to student
        parent = created_users.get("parent")
        student = created_users.get("student")
        if parent and student and not student.parent_id:
            student.parent_id = parent.id
            logger.info(f"Linked {student.name} to parent {parent.name}")

        # Generate invite code for student
        if student:
            from sqlalchemy import select
            existing_code = await db.execute(
                select(InviteCode).where(InviteCode.student_id == student.id)
            )
            if not existing_code.scalar_one_or_none():
                code = InviteCode.generate_code()
                invite = InviteCode(code=code, student_id=student.id, used=True)
                db.add(invite)
                logger.info(f"Generated invite code for {student.name}: {code}")

        # Create StudentProfile for the seeded student (gamification + learning preferences).
        #
        # KEY_STAGE and YEAR_GROUP are seeded deliberately, not left NULL. The seeded users are
        # marked onboarding_completed=True, so they never walk through onboarding — which is the
        # only other place these get set. Leaving them empty meant the test student landed on
        # /lesson/setup with Key Stage and Year Group locked at "Set in your profile" and no way
        # to start a lesson.
        #
        # KS3 / Year 9 is the default because it's mid-range and the Resource Hub has
        # plenty of KS3 Year 9 content, so a fresh seed can start a real lesson immediately.
        if student:
            from sqlalchemy import select as sa_select
            from app.models.student_profile import StudentProfile

            SEED_KEY_STAGE = "KS3"
            SEED_YEAR_GROUP = "Year 9"

            existing_profile = (await db.execute(
                sa_select(StudentProfile).where(StudentProfile.student_id == student.id)
            )).scalar_one_or_none()

            if existing_profile is None:
                profile = StudentProfile(
                    student_id=student.id,
                    xp_total=0,
                    xp_level=1,
                    current_streak=0,
                    longest_streak=0,
                    last_active_date=None,
                    interests=["Science", "Maths"],
                    preferred_subjects=["Maths", "Physics"],
                    key_stage=SEED_KEY_STAGE,
                    year_group=SEED_YEAR_GROUP,
                    # The tutor is handed these every turn, so give it something real to work with.
                    learning_style=["visual", "step_by_step"],
                    teaching_pace="just_right",
                    teaching_preferences={
                        "step_by_step": True,
                        "real_life_examples": True,
                        "practice_as_we_go": True,
                    },
                    learning_goals="Build confidence in algebra and graphs",
                )
                db.add(profile)
                logger.info(
                    f"Created StudentProfile for {student.name} "
                    f"({SEED_KEY_STAGE} / {SEED_YEAR_GROUP})"
                )
            elif not existing_profile.key_stage or not existing_profile.year_group:
                # Re-seeding over a DB whose profile predates this — backfill rather than skip,
                # otherwise the student stays stuck on "Set in your profile" forever.
                existing_profile.key_stage = existing_profile.key_stage or SEED_KEY_STAGE
                existing_profile.year_group = existing_profile.year_group or SEED_YEAR_GROUP
                logger.info(
                    f"Backfilled key stage / year group for {student.name} "
                    f"({existing_profile.key_stage} / {existing_profile.year_group})"
                )

        await db.commit()

    # Seed Casbin RBAC policies (role → object/action grants). Idempotent.
    try:
        from app.services.casbin_service import seed_default_policies
        await seed_default_policies()
        logger.info("Casbin default policies seeded")
    except Exception as e:
        logger.warning(f"Casbin policy seeding skipped: {e}")

    logger.info("Seed data inserted")


def main():
    logger.info("SmartAI Tutor - Database Seeding")
    logger.info("=" * 40)
    asyncio.run(run_seed())
    logger.info("")
    logger.info("Default credentials:")
    logger.info("  Administrator: administrator@smartai.com / administrator123")
    logger.info("  Admin:   admin@smartai.com   / admin123")
    logger.info("  Teacher: teacher@smartai.com / teacher123")
    logger.info("  Student: student@smartai.com / student123")
    logger.info("  Parent:  parent@smartai.com  / parent123")


if __name__ == "__main__":
    main()
