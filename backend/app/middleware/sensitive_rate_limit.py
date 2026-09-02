"""Stricter per-IP rate limits on sensitive endpoints (feature 15).

The global RateLimitMiddleware is a generous flood guard for interactive use. This adds a
much tighter bucket specifically for auth, verification, password reset, and billing
mutations — the endpoints worth brute-force / abuse protection — without affecting normal
app traffic. The provider webhook is deliberately exempt (it must always be reachable and
is signature-verified).
"""
import time
from collections import defaultdict

from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware

from app.observability import metrics

WINDOW_SECONDS = 60

# (path-prefix, methods, max-per-window). First match wins.
_RULES = [
    ("/api/auth/login", ("POST",), 15),
    ("/api/auth/register", ("POST",), 8),
    ("/api/auth/forgot-password", ("POST",), 6),
    ("/api/auth/reset-password", ("POST",), 10),
    ("/api/auth/resend-verification", ("POST",), 6),
    ("/api/auth/verify-email", ("POST",), 20),
    ("/api/billing/webhook", ("POST",), 100000),   # effectively exempt (signature-verified)
    ("/api/billing/subscribe", ("POST",), 20),
    ("/api/billing/topup", ("POST",), 20),
    ("/api/documents", ("POST",), 30),             # uploads
]


def _rule_for(path: str, method: str):
    for prefix, methods, cap in _RULES:
        if path.startswith(prefix) and method in methods:
            return prefix, cap
    return None


class SensitiveRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._hits = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        rule = _rule_for(request.url.path, request.method)
        if rule is None:
            return await call_next(request)
        prefix, cap = rule
        ip = request.client.host if request.client else "unknown"
        key = f"{ip}:{prefix}"
        now = time.time()
        window_start = now - WINDOW_SECONDS
        hits = [t for t in self._hits[key] if t > window_start]
        if len(hits) >= cap:
            self._hits[key] = hits
            metrics.incr("ratelimit.sensitive.blocked")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait a minute and try again.",
            )
        hits.append(now)
        self._hits[key] = hits
        return await call_next(request)
