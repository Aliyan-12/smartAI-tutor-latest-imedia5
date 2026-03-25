from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    app_name: str = "SmartAI Tutor"
    debug: bool = False

    postgres_user: str = "smartai"
    postgres_password: str = "smartai_secret_2024"
    postgres_db: str = "smartai_tutor"
    postgres_host: str = "db"
    postgres_port: int = 5432

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    jwt_secret_key: str = "change-this-to-a-random-64-char-string"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 1440

    backend_cors_origins: str = "http://localhost:5173,http://localhost:3000"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8001

    tts_provider: str = "google"
    whisper_model: str = "base"

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
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
