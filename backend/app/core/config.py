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
    gemini_model: str = "gemini-2.5-flash"

    jwt_secret_key: str = "change-this-to-a-random-64-char-string"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 1440

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
