"""When the `maintenance_mode` platform setting is on, only administrators may use the
API. The flag is read at most once every few seconds (cached) so this adds no per-request
DB cost in normal operation."""
import time
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.db.session import async_session_factory
from app.core.security import decode_access_token
from app.services import platform_settings_service as svc

logger = logging.getLogger(__name__)

# Always reachable so an admin can log in and turn maintenance back off.
_ALLOW_PREFIXES = ("/api/auth", "/api/admin", "/api/health", "/health", "/docs", "/openapi",
                   "/api/legal", "/api/billing/webhook")
_CACHE = {"on": False, "ts": 0.0}
_TTL = 15.0


class MaintenanceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or not path.startswith("/api") or any(path.startswith(p) for p in _ALLOW_PREFIXES):
            return await call_next(request)

        now = time.time()
        if now - _CACHE["ts"] > _TTL:
            try:
                async with async_session_factory() as db:
                    _CACHE["on"] = bool(await svc.value(db, "maintenance_mode"))
            except Exception:
                _CACHE["on"] = False
            _CACHE["ts"] = now

        if _CACHE["on"]:
            role = None
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                payload = decode_access_token(auth[7:])
                role = (payload or {}).get("role")
            if role != "administrator":
                return JSONResponse(
                    status_code=503,
                    content={"detail": "The platform is undergoing maintenance. Please try again shortly."},
                )
        return await call_next(request)
