"""Read/write configurable settings with validation, scope enforcement and an audit
trail. Other backend code reads effective values through `value()` so settings actually
change behaviour."""
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, ROLE_ADMINISTRATOR, ROLE_ADMIN
from app.models.platform_setting import PlatformSetting, SettingChange, SCOPE_PLATFORM, school_scope
from app.services import settings_registry as reg

logger = logging.getLogger(__name__)

MASK = "••••••••"


# ── validation / coercion ─────────────────────────────────────────────────
def _coerce(setting: reg.Setting, raw: Any) -> Any:
    t = setting.type
    if t == "bool":
        return bool(raw)
    if t in ("int", "float"):
        try:
            num = int(raw) if t == "int" else float(raw)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{setting.label} must be a number")
        if setting.min is not None and num < setting.min:
            raise HTTPException(400, f"{setting.label} must be ≥ {setting.min}")
        if setting.max is not None and num > setting.max:
            raise HTTPException(400, f"{setting.label} must be ≤ {setting.max}")
        return num
    if t == "enum":
        if raw not in (setting.options or []):
            raise HTTPException(400, f"{setting.label} must be one of {setting.options}")
        return raw
    if t == "list":
        if not isinstance(raw, list):
            raise HTTPException(400, f"{setting.label} must be a list")
        return [str(x)[:60] for x in raw][:50]
    # string / text
    return str(raw)[:5000]


# ── scope + permission ────────────────────────────────────────────────────
def _scope_for(setting: reg.Setting, school_id: Optional[int]) -> str:
    if setting.scope_type == "school":
        if not school_id:
            raise HTTPException(400, "A school context is required for this setting")
        return school_scope(school_id)
    return SCOPE_PLATFORM


def can_edit(setting: reg.Setting, user: User) -> bool:
    if setting.scope_type == "platform":
        return user.role == ROLE_ADMINISTRATOR
    # school-scoped: platform admin (any school) or a school admin (own school)
    return user.role in (ROLE_ADMINISTRATOR, ROLE_ADMIN)


# ── read ──────────────────────────────────────────────────────────────────
async def _stored(db: AsyncSession, scope: str, key: str) -> Optional[PlatformSetting]:
    res = await db.execute(select(PlatformSetting).where(PlatformSetting.scope == scope, PlatformSetting.key == key))
    return res.scalar_one_or_none()


async def value(db: AsyncSession, key: str, school_id: Optional[int] = None) -> Any:
    """Effective value: school override → platform override → registry default."""
    setting = reg.get(key)
    if setting is None:
        raise KeyError(key)
    if setting.scope_type == "school" and school_id:
        row = await _stored(db, school_scope(school_id), key)
        if row is not None:
            return row.value.get("v")
    row = await _stored(db, SCOPE_PLATFORM, key)
    if row is not None:
        return row.value.get("v")
    return setting.default


async def set_value(db: AsyncSession, user: User, key: str, raw: Any, reason: str = "",
                    school_id: Optional[int] = None) -> Any:
    setting = reg.get(key)
    if setting is None:
        raise HTTPException(404, f"Unknown setting '{key}'")
    if not can_edit(setting, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not permitted to change this setting")

    # School admins may only ever write their OWN school's scope.
    if setting.scope_type == "school":
        if user.role == ROLE_ADMIN:
            school_id = user.school_id
        if not school_id:
            raise HTTPException(400, "A school context is required for this setting")
    scope = _scope_for(setting, school_id)
    coerced = _coerce(setting, raw)

    row = await _stored(db, scope, key)
    old = row.value.get("v") if row is not None else setting.default
    if row is None:
        row = PlatformSetting(scope=scope, key=key, value={"v": coerced}, updated_by=user.id)
        db.add(row)
    else:
        row.value = {"v": coerced}
        row.updated_by = user.id

    db.add(SettingChange(scope=scope, key=key, old_value={"v": old}, new_value={"v": coerced},
                         actor_id=user.id, reason=reason or ""))
    await db.flush()
    logger.info("SETTING changed key=%s scope=%s by=%s", key, scope, user.id)
    return coerced


# ── admin schema (grouped, values resolved, masked) ───────────────────────
async def schema_for(db: AsyncSession, user: User) -> Dict[str, Any]:
    is_platform = user.role == ROLE_ADMINISTRATOR
    sections: Dict[str, Dict[str, Any]] = {}
    for key, label in reg.SECTIONS:
        sections[key] = {"key": key, "label": label, "settings": []}

    for s in reg.all_settings():
        # A school admin sees only school-scoped settings (their remit).
        if not is_platform and s.scope_type != "school":
            continue
        school_id = user.school_id if s.scope_type == "school" else None
        val = await value(db, s.key, school_id)
        sections[s.section]["settings"].append({
            "key": s.key, "label": s.label, "type": s.type, "scope_type": s.scope_type,
            "help": s.help, "options": s.options, "dangerous": s.dangerous,
            "sensitive": s.sensitive, "min": s.min, "max": s.max,
            "editable": can_edit(s, user),
            "value": MASK if s.sensitive else val,
        })
    # Drop empty sections (e.g. for a school admin).
    return {"sections": [v for v in sections.values() if v["settings"]]}


async def audit_list(db: AsyncSession, user: User, limit: int = 50) -> List[Dict[str, Any]]:
    q = select(SettingChange).order_by(desc(SettingChange.created_at)).limit(limit)
    if user.role != ROLE_ADMINISTRATOR:
        q = select(SettingChange).where(SettingChange.scope == school_scope(user.school_id)) \
            .order_by(desc(SettingChange.created_at)).limit(limit)
    res = await db.execute(q)
    out = []
    for c in res.scalars().all():
        s = reg.get(c.key)
        out.append({
            "key": c.key, "label": s.label if s else c.key, "scope": c.scope,
            "old_value": None if (s and s.sensitive) else (c.old_value or {}).get("v"),
            "new_value": None if (s and s.sensitive) else (c.new_value or {}).get("v"),
            "reason": c.reason, "actor_id": c.actor_id, "created_at": c.created_at,
        })
    return out
