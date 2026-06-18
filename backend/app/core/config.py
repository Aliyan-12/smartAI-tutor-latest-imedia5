from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List
import os

BASE_DIR = Path(__file__).resolve().parent.parent.parent
ROOT_DIR = BASE_DIR.parent
ENV_FILE = ROOT_DIR / ".env" if (ROOT_DIR / ".env").exists() else BASE_DIR / ".env"


class Settings(BaseSettings):
    app_name: str = "SmartAI Tutor"
    debug: bool = False

    postgres_user: str = ""
    postgres_password: str = ""
    postgres_db: str = "smartai_tutor"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-pro" #"gemini-2.5-flash"
    gemini_model_fast: str = "gemini-2.5-flash"
    # Per-pipeline LLMs: premium session vs free /chat.
    # Set GEMINI_SESSION_MODEL to a Gemini 3 id when ready.
    gemini_session_model: str = "gemini-2.5-pro"
    gemini_chat_model: str = "gemini-2.5-flash"

    jwt_secret_key: str = "change-this-to-a-random-64-char-string"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 1440

    # OAuth (Google) + session middleware for the Authlib handshake.
    google_client_id: str = ""
    google_client_secret: str = ""
    # Backend base URL used to build the OAuth redirect_uri
    # (e.g. http://localhost:8001 → /api/auth/oauth/google/callback).
    oauth_redirect_base_url: str = "http://localhost:8001"
    # Secret for Starlette SessionMiddleware (OAuth state). Falls back to the JWT secret.
    session_secret: str = ""
    # Frontend base URL — used in verification email links + OAuth success redirect.
    frontend_base_url: str = "http://localhost:5173"

    backend_cors_origins: str = "http://localhost:5173,http://localhost:3000"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8001

    tts_provider: str = "google"
    whisper_model: str = "base"

    embedding_model: str = "gemini-embedding-001"
    rag_chunk_size: int = 500
    rag_chunk_overlap: int = 50
    rag_top_k: int = 5
    rag_min_similarity: float = 0.3
    rag_enabled: bool = True
    upload_dir: str = "uploads/documents"
    max_upload_size_mb: int = 50

    # Resource Hub (external curriculum + content source).
    # resourcehub_api_url already includes the "/api" prefix; the client appends "/v1/...".
    resourcehub_api_key: str = ""
    resourcehub_api_url: str = "https://hub.resourcefullearning.co.uk/api"
    resource_sync_enabled: bool = True
    curriculum_sync_hours: int = 12
    resource_sync_hours: int = 6

    email_enabled: bool = False
    email_smtp_host: str = "smtp.gmail.com"
    email_smtp_port: int = 587
    email_smtp_user: str = ""
    email_smtp_password: str = ""
    email_from_address: str = "noreply@smartai.com"

    max_appointments_per_week: int = 100
    default_class_price: float = 25.00

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",")]

    class Config:
        env_file = str(ENV_FILE)
        env_file_encoding = "utf-8"


settings = Settings()
