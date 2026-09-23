"""Payment-provider abstraction.

Two implementations:
- StripeProvider — real Stripe, used when settings.stripe_secret_key is set. The `stripe`
  package is imported lazily so the app runs without it installed.
- MockProvider — a deterministic in-process stand-in used in dev/tests. It lets the whole
  subscribe → invoice.paid → credit-allocation loop run without any Stripe credentials.

Neither implementation ever handles raw card data — Stripe Checkout / Elements collect the
card on Stripe's side and we only ever see references.
"""
import logging
import secrets
import time
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def _rid(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(10)}"


class MockProvider:
    """Deterministic, credential-free provider for local dev + tests."""
    name = "mock"

    def create_customer(self, email: Optional[str], name: Optional[str]) -> str:
        return _rid("cus_mock")

    def create_subscription_checkout(self, *, customer_id: str, price_slug: str,
                                     success_url: str, cancel_url: str) -> Dict[str, Any]:
        # No hosted page in dev — the frontend calls the dev-complete endpoint which
        # replays the same webhook events Stripe would send.
        return {"mock": True, "session_id": _rid("cs_mock"), "url": None,
                "checkout_kind": "subscription", "price_slug": price_slug, "customer_id": customer_id}

    def create_payment_checkout(self, *, customer_id: str, package_slug: str, amount: float,
                                success_url: str, cancel_url: str) -> Dict[str, Any]:
        return {"mock": True, "session_id": _rid("cs_mock"), "url": None,
                "checkout_kind": "payment", "package_slug": package_slug,
                "amount": amount, "customer_id": customer_id}

    def create_billing_portal(self, *, customer_id: str, return_url: str) -> Dict[str, Any]:
        return {"url": None, "mock": True}

    def cancel_subscription(self, provider_subscription_id: str, at_period_end: bool = True) -> Dict[str, Any]:
        return {"id": provider_subscription_id, "cancel_at_period_end": at_period_end,
                "status": "active" if at_period_end else "canceled"}

    def reactivate_subscription(self, provider_subscription_id: str) -> Dict[str, Any]:
        return {"id": provider_subscription_id, "cancel_at_period_end": False, "status": "active"}

    def verify_webhook(self, payload: bytes, signature: Optional[str]) -> Dict[str, Any]:
        # Dev events are already JSON dicts submitted to the dev endpoint.
        import json
        return json.loads(payload.decode("utf-8"))


class StripeProvider:
    name = "stripe"

    def __init__(self):
        import stripe  # lazy — only needed when configured
        stripe.api_key = settings.stripe_secret_key
        self._stripe = stripe

    def create_customer(self, email: Optional[str], name: Optional[str]) -> str:
        c = self._stripe.Customer.create(email=email, name=name)
        return c.id

    def create_subscription_checkout(self, *, customer_id: str, price_slug: str,
                                     success_url: str, cancel_url: str) -> Dict[str, Any]:
        from app.services.billing.plans import price_id_for
        price_id = price_id_for(price_slug)
        if not price_id:
            raise ValueError(f"No Stripe price id configured for plan '{price_slug}'")
        session = self._stripe.checkout.Session.create(
            mode="subscription", customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url, cancel_url=cancel_url,
            metadata={"plan_slug": price_slug},
        )
        return {"mock": False, "session_id": session.id, "url": session.url}

    def create_payment_checkout(self, *, customer_id: str, package_slug: str, amount: float,
                                success_url: str, cancel_url: str) -> Dict[str, Any]:
        session = self._stripe.checkout.Session.create(
            mode="payment", customer=customer_id,
            line_items=[{
                "price_data": {
                    "currency": "gbp",
                    "product_data": {"name": f"Token top-up ({package_slug})"},
                    "unit_amount": int(round(amount * 100)),
                }, "quantity": 1,
            }],
            success_url=success_url, cancel_url=cancel_url,
            metadata={"package_slug": package_slug},
        )
        return {"mock": False, "session_id": session.id, "url": session.url}

    def create_billing_portal(self, *, customer_id: str, return_url: str) -> Dict[str, Any]:
        s = self._stripe.billing_portal.Session.create(customer=customer_id, return_url=return_url)
        return {"url": s.url, "mock": False}

    def cancel_subscription(self, provider_subscription_id: str, at_period_end: bool = True) -> Dict[str, Any]:
        if at_period_end:
            s = self._stripe.Subscription.modify(provider_subscription_id, cancel_at_period_end=True)
        else:
            s = self._stripe.Subscription.cancel(provider_subscription_id)
        return {"id": s.id, "cancel_at_period_end": s.cancel_at_period_end, "status": s.status}

    def reactivate_subscription(self, provider_subscription_id: str) -> Dict[str, Any]:
        s = self._stripe.Subscription.modify(provider_subscription_id, cancel_at_period_end=False)
        return {"id": s.id, "cancel_at_period_end": s.cancel_at_period_end, "status": s.status}

    def verify_webhook(self, payload: bytes, signature: Optional[str]) -> Dict[str, Any]:
        if not settings.stripe_webhook_secret:
            raise ValueError("stripe_webhook_secret not configured")
        event = self._stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)
        return event  # a stripe Event behaves like a dict


_provider = None


def get_provider():
    """Stripe when configured, otherwise the credential-free mock."""
    global _provider
    if _provider is not None:
        return _provider
    if settings.stripe_secret_key:
        try:
            _provider = StripeProvider()
            logger.info("BILLING provider=stripe mode=%s", settings.stripe_mode)
        except Exception as e:  # missing package / bad key → fail safe to mock
            logger.warning("BILLING stripe init failed (%s); using mock provider", e)
            _provider = MockProvider()
    else:
        _provider = MockProvider()
        logger.info("BILLING provider=mock (no stripe_secret_key)")
    return _provider


def is_mock() -> bool:
    return get_provider().name == "mock"
