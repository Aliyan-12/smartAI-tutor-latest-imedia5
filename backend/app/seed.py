"""
Database seed script.
Populates the database with initial data: admin user, sample teacher, sample student.

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
]


async def run_seed():
    from app.db.session import async_session_factory
    from app.services.user_service import get_user_by_email, create_user

    async with async_session_factory() as db:
        for user_data in SEED_USERS:
            existing = await get_user_by_email(db, user_data["email"])
            if existing:
                logger.info(f"User already exists: {user_data['email']} (skipping)")
                continue

            user = await create_user(
                db,
                name=user_data["name"],
                email=user_data["email"],
                password=user_data["password"],
                role=user_data["role"],
                credits=user_data["credits"],
            )
            logger.info(f"Created {user.role}: {user.email}")

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


if __name__ == "__main__":
    main()
