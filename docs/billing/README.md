# Billing (features 09 & 10)

Production-grade billing built on a **provider abstraction** so the app runs with or
without Stripe credentials.

## Providers

| Condition | Provider | Behaviour |
|-----------|----------|-----------|
| `STRIPE_SECRET_KEY` set | `StripeProvider` | Real Stripe Checkout, subscriptions, invoices, webhooks. |
| unset (default in dev) | `MockProvider` | Deterministic, credential-free. The `POST /api/billing/dev/complete` endpoint replays the exact webhook sequence Stripe would send so the full subscribe → invoice.paid → credit-allocation loop is exercised locally. |

The backend **never receives or stores raw card data** (PAN/CVC). It stores only provider
references: customer id, payment-method id + brand/last4/expiry, price id, subscription id,
invoice id.

## Credit allocation guarantees

- Credits are granted **only** on authoritative provider events (`invoice.paid`, top-up
  `checkout.session.completed`) — never on a Subscribe button click.
- Two layers of idempotency prevent double-crediting on webhook re-delivery:
  1. `billing_webhook_events.event_id` is unique — a re-delivered event id is a no-op.
  2. `billing_ledger.idempotency_key` is unique (`invoice:<id>`, `checkout:<session>`) — a
     new event that references an already-allocated invoice/session cannot credit twice.
- The ledger is **append-only**. A wallet's balance always equals its latest entry's
  `balance_after`. Refunds and manual credits are additional signed entries with a reason +
  actor.

## Environment variables

```
STRIPE_SECRET_KEY=sk_test_...        # empty → mock provider
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...      # required to verify live webhooks
STRIPE_MODE=test                     # test | live
STRIPE_PRICE_IDS={"individual_family":"price_...","school_class":"price_..."}
```

Never expose the secret or webhook keys to the frontend. Only the publishable key is
client-safe.

## Local development

1. Leave `STRIPE_SECRET_KEY` empty — the mock provider is used.
2. Subscribe/top-up from the UI. In mock mode the UI calls `dev/complete`, which replays the
   webhook events, so credits appear immediately.

### Testing against real Stripe (test mode)

1. Set the `STRIPE_*` test-mode keys and `STRIPE_PRICE_IDS`.
2. Forward webhooks to the backend:
   ```
   stripe listen --forward-to localhost:8001/api/billing/webhook
   ```
   Use the `whsec_...` it prints as `STRIPE_WEBHOOK_SECRET`.
3. Use Stripe test cards (e.g. `4242 4242 4242 4242`).

## Webhook events handled

`checkout.session.completed`, `customer.subscription.created/updated/deleted`,
`invoice.paid` / `invoice.payment_succeeded`, `invoice.payment_failed`,
`payment_method.attached`.

## Verification performed

The subscribe → webhook → allocation loop and both idempotency layers were verified
end-to-end against the mock provider (duplicate event id → no-op; new event id referencing
the same invoice/session → ledger skip; balance credited exactly once). An automated pytest
harness against a Postgres test database is tracked with the QA work (feature 15).
