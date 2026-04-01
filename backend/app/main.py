import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.routers import auth, chat, voice, health, admin, teacher, subscription, documents

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="AI-powered tutoring platform API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(admin.router)
app.include_router(teacher.router)
app.include_router(subscription.router)
app.include_router(documents.router)
