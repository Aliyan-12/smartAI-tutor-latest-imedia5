# Security & Production-Readiness Audit

Scope: the production-hardening pass (feature 15). Each area below lists its posture and
the concrete controls in place. "Added (F15)" = introduced in this pass; other items were
hardened by earlier feature branches and are re-verified here.

## Authentication & session
- **JWT lifecycle** — HS256, expiry via `jwt_expiration_minutes`; tokens carry `sub`, `role`,
  and `tv` (token version). `get_current_user` rejects a token whose `tv` ≠ the user's
  `token_version`, giving real **session revocation** ("log out of all devices"; also bumped
  on password change). Legacy tokens (no `tv`) read as 0 and keep working until the first bump.
- **Password reset / email verification** — one-time expiring tokens; login blocked until
  verified. Sensitive endpoints are **rate-limited** (Added F15): login 15/min, register 8/min,
  forgot-password 6/min, reset 10/min, resend-verification 6/min, per IP.
- **OAuth** — Authlib Google flow, gated to 503 until client id/secret set; state/nonce via
  `SessionMiddleware`.
- **Password storage** — bcrypt via passlib. No plaintext.

## Authorization & tenancy
- **RBAC** — Casbin (role→obj→act) plus service-layer school scoping.
- **Tenant isolation** — school-scoped reads/writes; `list_students` and all class-progress
  aggregates are filtered to the teacher's own `school_id` (administrators cross-school).
  Billing wallets are keyed by owner (user|school) — a school admin can never read another
  school's wallet.
- **Parent–child authorization** — every child-data endpoint checks the parent↔child link;
  a parent can only ever read their own linked children. Teacher views require same-school.
- **Sensitive-data access audit** (F14) — parent/teacher views of a child's mastery write an
  immutable `access_audit` row; administrators can review recent access.

## Billing / webhooks
- Card data never touches the backend — only provider references + brand/last4.
- Webhooks are **signature-verified** (Stripe) and **double-idempotent**: unique event ids and
  unique ledger keys (invoice/checkout) prevent double-crediting on re-delivery.
- Credits are granted only on authoritative provider events, never on a button click.
- Append-only ledger; refunds/manual credits are signed, reasoned, actor-stamped entries.
- **Reconciliation** (Added F15) — the observability endpoint flags any wallet whose balance
  drifts from its ledger tail (should always be 0).

## Uploads / parsing / rendering
- Evidence/document uploads: type + size limits; scan hook. Upload endpoints rate-limited (F15).
- SVG sanitiser allow-list and the Manim two-layer sandbox (AST + process isolation) remain in
  place for model-authored visuals.

## Transport / platform
- **CORS** — restricted to configured origins.
- **WebSocket auth** — token via query param; the token is **not** logged (the observability
  logger records the path only, never the query string).
- **Maintenance mode** — a platform setting can put the API into admin-only mode.
- **Rate limiting** — global per-IP flood guard + the sensitive-endpoint limiter (F15).

## Observability & error handling (Added F15)
- **Request/correlation IDs** — every request gets an `X-Request-ID` (honouring an inbound one),
  echoed in the response and stamped on every log line (`rid=…`).
- **Structured request logs** — one line per request: method, path, status, duration.
- **Safe error responses** — the global handler returns an opaque message + the request id;
  the full stack trace + id go only to the server log. No internals/secrets to clients.
- **Health** — `/api/health` (liveness), `/api/health/ready` (DB readiness → 503 if down),
  `/api/health/deps` (provider/dependency snapshot).
- **Metrics** — in-process counters (requests, statuses, errors, webhook processing,
  notification delivery, rate-limit blocks) at `/api/admin/observability` (administrator).

## Secrets
- All provider credentials come from environment variables (`STRIPE_*`, `GEMINI_API_KEY`,
  `GOOGLE_CLIENT_*`, `SESSION_SECRET`, SMTP). None are returned to the frontend; the settings
  UI masks sensitive values and never exposes keys.

## Data model / migrations
- New tables auto-create via `create_all`; existing tables use idempotent raw-SQL migrations in
  `app/setup.py`. Incompatible legacy tables are dropped only when their schema is the old one
  (guarded `DO` blocks) so `create_all` rebuilds them. **Indexes** for the new high-volume
  queries added (F15): mastery evidence, billing ledger, notifications, access audit, topic
  mastery state.

## Known limitations / follow-ups
- Notification email delivery is a best-effort hook; wire a real provider + retry queue before
  relying on email (in-app delivery is reliable today).
- An automated pytest suite against a Postgres test database is scaffolded (mastery algorithm
  unit tests run today); expand webhook/permission integration tests next.
- CSRF: the API is token-in-header (not cookie-auth) so classic CSRF does not apply; revisit if
  cookie sessions are ever introduced.
