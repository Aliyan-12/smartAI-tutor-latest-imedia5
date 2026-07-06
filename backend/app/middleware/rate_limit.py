import time
from collections import defaultdict
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware

# Generous per-IP cap for interactive use. A single lesson/page fires MANY API + media
# requests in short bursts (curriculum dropdowns, credits, profile, RAG embeddings, and a
# stream of generated puzzle images), so the old 60/min tripped after only a few clicks.
# This limiter only exists to stop a runaway flood, not to pace normal usage.
MAX_REQUESTS = 600
WINDOW_SECONDS = 60

# Paths that must NOT count toward the limit: API docs, health checks, and the
# static/media the frontend loads in bursts (generated puzzle images, uploads, slides,
# images). These are the calls that used to exhaust the window during a normal lesson.
_EXEMPT_PREFIXES = (
    "/docs", "/openapi", "/redoc", "/health",
    "/api/puzzles/media", "/uploads", "/static", "/images",
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP flood guard for HTTP requests only.

    Note: Starlette's BaseHTTPMiddleware is invoked ONLY for `http` scope, so WebSocket
    connections (the chat/session/voice socket) bypass this entirely and are never
    rate-limited here — concurrent voice/session sockets are unaffected.
    """

    def __init__(self, app):
        super().__init__(app)
        self._requests = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path == "/" or any(path.startswith(p) for p in _EXEMPT_PREFIXES):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window_start = now - WINDOW_SECONDS

        hits = [ts for ts in self._requests[client_ip] if ts > window_start]

        if len(hits) >= MAX_REQUESTS:
            self._requests[client_ip] = hits  # keep pruned list; don't record this hit
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down.",
            )

        hits.append(now)
        self._requests[client_ip] = hits
        return await call_next(request)
