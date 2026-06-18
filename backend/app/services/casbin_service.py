"""
Casbin policy-based RBAC.

Casbin is the authority for "can a ROLE perform ACT on OBJ?". Cross-school
isolation (a superadmin of school A may not touch school B) is enforced at the
service layer via school_id filtering — Casbin's domain is threaded through so
per-school policy overrides can be added later. Policies persist in the
`casbin_rule` table via the async SQLAlchemy adapter (same Postgres DB).
"""
import logging
from pathlib import Path
from typing import Optional

import casbin

logger = logging.getLogger(__name__)

_MODEL_PATH = str(Path(__file__).resolve().parent.parent / "core" / "casbin_model.conf")
_enforcer: Optional[casbin.AsyncEnforcer] = None

# Default role → (object, action) grants. dom "*" applies in any tenant.
# Each admin is a school admin (school-scoped at the service layer).
DEFAULT_POLICIES = [
    ("role:admin", "*", "*", "*"),                 # school admin: everything in their school
    ("role:teacher", "*", "content", "manage"),
    ("role:teacher", "*", "student", "read"),
    ("role:teacher", "*", "assignment", "manage"),
    ("role:teacher", "*", "session", "read"),
    ("role:student", "*", "session", "use"),
    ("role:student", "*", "assignment", "submit"),
    ("role:parent", "*", "appointment", "book"),
    ("role:parent", "*", "child", "read"),
]


def _domain(school_id) -> str:
    return f"school:{school_id}" if school_id else "school:none"


async def get_enforcer() -> casbin.AsyncEnforcer:
    """Lazily build the singleton enforcer (async adapter over Postgres)."""
    global _enforcer
    if _enforcer is not None:
        return _enforcer
    from casbin_async_sqlalchemy_adapter import Adapter
    from app.db.session import engine

    adapter = Adapter(engine)
    try:
        await adapter.create_table()
    except Exception:
        # Table is also created by app/setup.py — non-fatal if already present.
        pass
    e = casbin.AsyncEnforcer(_MODEL_PATH, adapter)
    await e.load_policy()
    _enforcer = e
    logger.info("Casbin enforcer initialised (%d policies)", len(e.get_policy()))
    return _enforcer


async def seed_default_policies() -> None:
    """Insert any missing default role grants. Idempotent."""
    e = await get_enforcer()
    added = 0
    for pol in DEFAULT_POLICIES:
        if not e.has_policy(*pol):
            await e.add_policy(*pol)
            added += 1
    if added:
        logger.info("Casbin: added %d default policies", added)


async def check_permission(role: str, school_id, obj: str, act: str) -> bool:
    """True if `role` may perform `act` on `obj` within its tenant."""
    e = await get_enforcer()
    return e.enforce(f"role:{role}", _domain(school_id), obj, act)
