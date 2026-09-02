"""The authoritative catalogue of configurable settings.

Each entry declares its section, type, default, scope and edit rules. The service, the
API schema and the admin UI all derive from this single source, so a setting can never
be edited or read outside its declared bounds. Adding a setting here is all that's
needed for it to appear in the admin centre.
"""
from dataclasses import dataclass, field
from typing import Any, List, Optional

# scope_type: "platform" (only the platform administrator) or
#             "school"   (a school admin edits their school's override; platform admin any).
# type: bool | int | float | string | text | enum | list


@dataclass(frozen=True)
class Setting:
    key: str
    section: str
    label: str
    type: str
    default: Any
    scope_type: str = "platform"
    help: str = ""
    options: Optional[List[str]] = None
    sensitive: bool = False       # value masked in the API/UI
    dangerous: bool = False       # UI requires explicit confirmation
    min: Optional[float] = None
    max: Optional[float] = None


REGISTRY: List[Setting] = [
    # 1 — Platform
    Setting("platform_name", "platform", "Platform name", "string", "SmartAI Tutor"),
    Setting("support_email", "platform", "Support email", "string", "support@smartaitutor.online"),
    Setting("default_timezone", "platform", "Default timezone", "string", "Europe/London"),
    Setting("maintenance_mode", "platform", "Maintenance mode", "bool", False,
            help="When on, only administrators can use the platform.", dangerous=True),

    # 2 — Schools
    Setting("school_verification_required", "schools", "Require school verification", "bool", True),
    Setting("allowed_countries", "schools", "Allowed countries", "list", ["GB", "AE"],
            help="ISO country codes schools may register from."),
    Setting("school_approval_policy", "schools", "School approval policy", "enum", "manual",
            options=["manual", "auto"]),
    Setting("domain_verification_required", "schools", "Require domain verification", "bool", False),

    # 3 — Billing
    Setting("billing_enabled", "billing", "Billing enabled", "bool", False, dangerous=True,
            help="Turns paid plans and top-ups on across the platform."),
    Setting("payment_model", "billing", "Payment model", "enum", "hybrid",
            options=["subscription", "token_topup", "hybrid"]),
    Setting("currency", "billing", "Currency", "enum", "GBP", options=["GBP", "USD", "EUR", "AED"]),
    Setting("tax_rate_percent", "billing", "Tax rate (%)", "float", 0.0, min=0, max=100),
    Setting("invoice_prefix", "billing", "Invoice prefix", "string", "SMART"),
    Setting("invoice_numbering", "billing", "Invoice numbering", "enum", "sequential",
            options=["sequential", "per_school"]),
    Setting("billing_grace_period_days", "billing", "Grace period (days)", "int", 7, min=0, max=90),

    # 4 — Credits / tokens
    Setting("default_credits", "credits", "Default new-student credits", "int", 100, min=0, max=100000),
    Setting("message_cost", "credits", "Credits per message", "float", 1.0, min=0, max=1000),
    Setting("rollover_policy", "credits", "Credit rollover", "enum", "monthly",
            options=["none", "monthly", "full"]),
    Setting("school_topup_enabled", "credits", "Allow school top-ups", "bool", True, scope_type="school"),

    # 5 — Notifications
    Setting("notifications_enabled", "notifications", "System notifications enabled", "bool", True),
    Setting("email_from_name", "notifications", "Email 'from' name", "string", "SmartAI Tutor"),

    # 6 — Security
    Setting("password_min_length", "security", "Minimum password length", "int", 8, min=6, max=64),
    Setting("session_duration_minutes", "security", "Session duration (minutes)", "int", 1440, min=15, max=43200),
    Setting("rate_limit_per_minute", "security", "API rate limit (per minute)", "int", 120, min=10, max=10000),
    Setting("suspicious_login_lockout", "security", "Lock out suspicious logins", "bool", True),

    # 7 — AI governance
    Setting("ai_disclosure_text", "ai", "AI disclosure text", "text",
            "You're learning with an AI tutor. Responses are generated and may contain mistakes."),
    Setting("web_research_enabled", "ai", "Allow web research", "bool", True),
    Setting("ai_data_retention_days", "ai", "AI data retention (days)", "int", 365, min=1, max=3650),

    # School-scoped classroom policy (edited by school admins; feeds teacher permissions).
    Setting("teachers_can_manage_assignments", "school_policy", "Teachers can manage assignments",
            "bool", True, scope_type="school"),
    Setting("school_default_session_length", "school_policy", "Default session length (min)",
            "int", 40, scope_type="school", min=20, max=90),
    Setting("teachers_can_view_billing", "school_policy", "Teachers can view billing balance",
            "bool", False, scope_type="school"),
]

SECTIONS = [
    ("platform", "Platform"),
    ("schools", "Schools"),
    ("billing", "Billing"),
    ("credits", "Credits & tokens"),
    ("notifications", "Notifications"),
    ("security", "Security"),
    ("ai", "AI governance"),
    ("school_policy", "School policy"),
]

_BY_KEY = {s.key: s for s in REGISTRY}


def get(key: str) -> Optional[Setting]:
    return _BY_KEY.get(key)


def all_settings() -> List[Setting]:
    return list(REGISTRY)
