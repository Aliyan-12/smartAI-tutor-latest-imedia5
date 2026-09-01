# Compliance documentation

Working scaffolds supporting the SmartAI Tutor legal/privacy foundation. **None of this is legal
advice** — it is a starting point for the owner's Data Protection Officer / legal counsel.

| Doc | Purpose |
|-----|---------|
| `DPIA.md` | Data Protection Impact Assessment scaffold (required for children's data / profiling). |
| `PROCESSING_REGISTER.md` | Record of processing activities (Art. 30). |
| `DATA_RETENTION.md` | Retention schedule per data category. |
| `PROCESSORS.md` | Third-party processors / sub-processors. |
| `LEGAL_REVIEW_CHECKLIST.md` | What must be reviewed/signed off before launch. |

The in-app legal documents live in the database (`legal_documents`, seeded from
`backend/app/services/legal_service.py`) and are versioned with auditable user acceptance.
