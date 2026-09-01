# Data retention schedule — scaffold

> DRAFT — confirm periods with legal/finance. Deleting a user account must NOT delete records the
> law requires us to keep (e.g. financial records).

| Category | Store | Retention (proposed) | Notes |
|----------|-------|----------------------|-------|
| Account (user, profile) | `users`, `student_profiles` | Until deletion + [30] days | Then anonymise/erase |
| Chats / messages | `chats`, `messages` | [12] months rolling | Configurable |
| Session reports | `lesson_plans` | [24] months | Learning record |
| Session audio | transient / not stored long-term | [ephemeral / configurable] | Confirm storage |
| Uploaded documents | `documents` | Until deletion or [12] months | User-controlled |
| Billing records | billing tables | [6–7] years | **Legal/finance retention — survives account deletion** |
| Audit logs | audit store | [12–24] months | Security/forensics |
| Legal acceptances | `legal_acceptances` | Life of account + [ ] | Proof of consent |
| Data requests | `data_requests` | [ ] | DSAR audit trail |
