"""Billing plan + token-package catalogue.

Plans map to provider Prices (Stripe recurring prices in production, resolved from
settings.stripe_price_ids). Prices/amounts are authoritative here on the backend — the
frontend never decides an amount or tax.
"""
import json
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.core.config import settings


@dataclass(frozen=True)
class Plan:
    slug: str
    name: str
    audience: str           # "individual" | "school"
    price: float            # in major currency units (e.g. GBP)
    credits_per_period: int
    interval: str = "month"
    description: str = ""


@dataclass(frozen=True)
class TokenPackage:
    slug: str
    name: str
    audience: str
    price: float
    credits: int
    description: str = ""


PLANS: List[Plan] = [
    Plan("individual_starter", "Starter", "individual", 9.99, 500, "month", "For a single learner."),
    Plan("individual_family", "Family", "individual", 19.99, 1200, "month", "Best value for families."),
    Plan("school_class", "Classroom", "school", 49.00, 4000, "month", "For a class of students."),
    Plan("school_site", "Whole school", "school", 199.00, 20000, "month", "Unlimited classes across a school."),
]

TOKEN_PACKAGES: List[TokenPackage] = [
    TokenPackage("topup_small", "Small top-up", "school", 25.00, 500, "500 credits."),
    TokenPackage("topup_medium", "Medium top-up", "school", 45.00, 1000, "1,000 credits (10% bonus)."),
    TokenPackage("topup_large", "Large top-up", "school", 200.00, 5000, "5,000 credits (25% bonus)."),
]

_PLANS_BY_SLUG = {p.slug: p for p in PLANS}
_PKG_BY_SLUG = {p.slug: p for p in TOKEN_PACKAGES}


def get_plan(slug: str) -> Optional[Plan]:
    return _PLANS_BY_SLUG.get(slug)


def get_package(slug: str) -> Optional[TokenPackage]:
    return _PKG_BY_SLUG.get(slug)


def plans_for(audience: str) -> List[Plan]:
    return [p for p in PLANS if p.audience == audience]


def packages_for(audience: str) -> List[TokenPackage]:
    return [p for p in TOKEN_PACKAGES if p.audience == audience]


def price_id_for(slug: str) -> Optional[str]:
    """Resolve a configured Stripe Price id for a plan slug (production)."""
    if not settings.stripe_price_ids:
        return None
    try:
        mapping: Dict[str, str] = json.loads(settings.stripe_price_ids)
    except json.JSONDecodeError:
        return None
    return mapping.get(slug)
