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


async def run_migrations():
    from sqlalchemy import text
    from app.db.session import engine
    _migrations = [
        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id)",
    ]
    async with engine.begin() as conn:
        for sql in _migrations:
            try:
                await conn.execute(text(sql))
                logger.info(f"Migration applied: {sql[:70]}")
            except Exception as e:
                logger.warning(f"Migration skipped: {e}")


async def run_seed():
    # await run_migrations()
    from app.db.session import async_session_factory
    from app.services.user_service import get_user_by_email, create_user
    from app.models.parent_student import InviteCode

    async with async_session_factory() as db:
        created_users = {}
        for user_data in SEED_USERS:
            existing = await get_user_by_email(db, user_data["email"])
            if existing:
                logger.info(f"User already exists: {user_data['email']} (skipping)")
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
            created_users[user_data["role"]] = user
            logger.info(f"Created {user.role}: {user.email}")

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

        # Create StudentProfile for the seeded student (gamification)
        if student:
            from sqlalchemy import select as sa_select
            from app.models.student_profile import StudentProfile
            existing_profile = await db.execute(
                sa_select(StudentProfile).where(StudentProfile.student_id == student.id)
            )
            if not existing_profile.scalar_one_or_none():
                profile = StudentProfile(
                    student_id=student.id,
                    xp_total=0,
                    xp_level=1,
                    current_streak=0,
                    longest_streak=0,
                    last_active_date=None,
                    interests=["Science", "Maths"],
                    preferred_subjects=["Maths", "Physics"],
                )
                db.add(profile)
                logger.info(f"Created StudentProfile for {student.name}")

        await db.commit()

    logger.info("Seed data inserted")


def main():
    logger.info("SmartAI Tutor - Database Seeding")
    logger.info("=" * 40)
    asyncio.run(run_seed())
    logger.info("")
    logger.info("Default credentials:")
    logger.info("  Admin:   admin@smartai.com   / admin123")
    logger.info("  Teacher: teacher@smartai.com / teacher123")
    logger.info("  Student: student@smartai.com / student123")
    logger.info("  Parent:  parent@smartai.com  / parent123")


if __name__ == "__main__":
    main()
