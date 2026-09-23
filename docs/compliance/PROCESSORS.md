# Third-party processors / sub-processors — scaffold

> DRAFT — verify each against a signed DPA and confirm data location.

| Processor | Purpose | Data shared | Location | DPA |
|-----------|---------|-------------|----------|-----|
| Google (Gemini) | AI lesson/text generation, embeddings | Lesson prompts/content | [region] | [link] |
| Stripe | Payments (recurring billing) | Billing/customer, card handled by Stripe | [region] | [link] |
| Email/SMTP provider | Verification/notification email | Email address, name | [region] | [link] |
| Hosting/DB provider | App + PostgreSQL hosting | All app data at rest | [region] | [link] |
| (Emoji/asset CDN) | UI assets | IP address on asset fetch | — | **self-host to avoid — see THIRD_PARTY_NOTICES** |

Keep this list current; notify affected users of material sub-processor changes where required.
