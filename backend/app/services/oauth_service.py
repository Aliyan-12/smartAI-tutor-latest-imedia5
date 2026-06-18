"""Authlib OAuth registry. FastAPI is Starlette-based, so we use the Starlette
integration (needs SessionMiddleware, added in main.py). Google is registered via
its OpenID discovery document; client id/secret come from settings."""
import logging

from authlib.integrations.starlette_client import OAuth

from app.core.config import settings

logger = logging.getLogger(__name__)

oauth = OAuth()

oauth.register(
    name="google",
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_id=settings.google_client_id or None,
    client_secret=settings.google_client_secret or None,
    client_kwargs={"scope": "openid email profile"},
)


def google_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def google_callback_url() -> str:
    return f"{settings.oauth_redirect_base_url.rstrip('/')}/api/auth/oauth/google/callback"
