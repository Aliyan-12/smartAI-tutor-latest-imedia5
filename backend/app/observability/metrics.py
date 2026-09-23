"""Tiny in-process metrics registry (feature 15).

Process-local counters/gauges — enough to surface webhook processing, billing
reconciliation, notification delivery and session/error rates on an admin observability
endpoint without pulling in a full metrics backend. Thread-safe for the async server's
single-process workers.
"""
import threading
import time
from collections import defaultdict
from typing import Dict

_lock = threading.Lock()
_counters: Dict[str, int] = defaultdict(int)
_gauges: Dict[str, float] = {}
_started_at = time.time()


def incr(name: str, by: int = 1) -> None:
    with _lock:
        _counters[name] += by


def gauge(name: str, value: float) -> None:
    with _lock:
        _gauges[name] = value


def snapshot() -> Dict[str, object]:
    with _lock:
        return {
            "uptime_seconds": round(time.time() - _started_at, 1),
            "counters": dict(_counters),
            "gauges": dict(_gauges),
        }


def reset() -> None:
    """Test helper only."""
    with _lock:
        _counters.clear()
        _gauges.clear()
