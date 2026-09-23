from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List

BASE_DIR = Path(__file__).resolve().parent.parent.parent
ROOT_DIR = BASE_DIR.parent
ENV_FILE = ROOT_DIR / ".env" if (ROOT_DIR / ".env").exists() else BASE_DIR / ".env"


class Settings(BaseSettings):
    app_name: str = "SmartAI Tutor"
    # DEBUG=true turns on EXTREME step-by-step logging (each agent's task + final answer, every
    # tool call + result, RAG chunks, deck map, slide moves, puzzle/image tools) so a lesson can be
    # traced end to end. false = the normal concise logs. Env: DEBUG.
    debug: bool = False

    postgres_user: str = ""
    postgres_password: str = ""
    postgres_db: str = "smartai_tutor"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-pro"   # legacy default (STT + one-shot briefing paths)
    # Per-pipeline LLMs: in-lesson SESSION (all lesson agents + quiz/eval) vs free /chat.
    # The session model is gemini-2.5-flash by default: ~3-5x faster to first token than pro, and
    # more than capable here — the lesson is heavily scaffolded (state anchor, tool guards, forced
    # recoveries), so the model does less unaided reasoning than the tool count suggests. Override
    # with GEMINI_SESSION_MODEL=gemini-2.5-pro to trade speed for reasoning depth. Env: GEMINI_SESSION_MODEL.
    gemini_session_model: str = "gemini-2.5-flash"
    gemini_chat_model: str = "gemini-2.5-flash"
    # Thinking tokens emitted BEFORE the answer on every round — directly additive latency.
    # Was hard-coded at 2048 (several seconds/round). A small budget keeps occasional thought
    # summaries for the thinking strip while cutting most of that delay; 0 disables thinking
    # entirely for the lowest latency. Env: GEMINI_THINKING_BUDGET.
    gemini_thinking_budget: int = 512
    # "Nano Banana Pro" — the latest PRO native image model, used for puzzle/explanatory teaching
    # images (better labelling + accuracy than flash-image). Most explanatory images are PRE-SEEDED
    # (app.seed_explanatory_images), so the higher per-image cost is paid once, not per lesson.
    # Overridable via GEMINI_IMAGE_MODEL.
    gemini_image_model: str = "gemini-3-pro-image"
    # Where generated puzzle media (Nano Banana PNGs + matplotlib graphs) are written,
    # then served publicly at /api/puzzles/media/{name}.
    puzzle_media_dir: str = "uploads/gen_puzzles"

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

    # Billing / payments (feature 09/10). When stripe_secret_key is empty the backend
    # uses a built-in MOCK provider so billing works end-to-end in dev without real keys.
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_mode: str = "test"            # test | live
    # Optional Stripe Price IDs per plan slug, JSON: {"individual_monthly":"price_...","school_monthly":"price_..."}
    stripe_price_ids: str = ""

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
    # How long the backend waits after boot before the FIRST sync of each job. The sync is
    # deliberately not part of startup: after a rebuild you need a window in which to run
    # `python -m app.setup --fresh` (which drops and recreates the schema) without a sync
    # holding table locks or writing into a schema that's about to be dropped. Once this
    # delay elapses, the jobs run on their normal intervals.
    resource_sync_start_delay_minutes: int = 1

    email_enabled: bool = False
    email_smtp_host: str = "smtp.gmail.com"
    email_smtp_port: int = 587
    email_smtp_user: str = ""
    email_smtp_password: str = ""
    email_from_address: str = "noreply@smartai.com"

    max_appointments_per_week: int = 100

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
