"""Request correlation IDs + structured request logging (feature 15).

Assigns every request an id (honouring an inbound X-Request-ID), stores it in a context var
so any log line can include it, logs one structured line per request with method/path/status/
duration, echoes the id back in the response header, and records latency/status metrics.
Never logs request bodies, auth headers, tokens, or query strings (which can carry the WS
token) — only the path.
"""
import time
import uuid
import logging
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware

from app.observability import metrics

logger = logging.getLogger("request")

# Readable by any logging code (see RequestIdFilter) to stamp the current request id.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        return True


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_ctx.set(rid)
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            dur_ms = (time.perf_counter() - start) * 1000.0
            metrics.incr("http.requests")
            metrics.incr(f"http.status.{status_code // 100}xx")
            if status_code >= 500:
                metrics.incr("http.errors")
            # One structured line per request. Path only — never the query string.
            logger.info(
                "rid=%s method=%s path=%s status=%s dur_ms=%.1f",
                rid, request.method, request.url.path, status_code, dur_ms,
            )
            request_id_ctx.reset(token)
