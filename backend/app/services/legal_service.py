"""
Legal document templates + consent/versioning logic.

⚠️ The text below is a DRAFT scaffold to give the product a complete, versioned legal surface.
It is NOT legal advice and MUST be reviewed and finalised by the owner's legal counsel before
launch (see /docs/compliance/LEGAL_REVIEW_CHECKLIST.md). Placeholders are wrapped in [BRACKETS].
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.legal import LegalDocument, LegalAcceptance

CURRENT_VERSION = "1.0-draft"

_DRAFT_BANNER = (
    "> **DRAFT — pending legal review.** This document is a template scaffold and is not legal "
    "advice. Text in [BRACKETS] must be completed and the whole document approved by [COMPANY]'s "
    "legal counsel before launch.\n\n"
)


def _doc(title, summary, content, requires_consent=False):
    return {"title": title, "summary": summary, "requires_consent": requires_consent,
            "content": _DRAFT_BANNER + content}


# key -> template. `requires_consent=True` documents trigger the acceptance + re-consent flow.
TEMPLATES: dict[str, dict] = {
    "privacy_policy": _doc(
        "Privacy Policy",
        "How we look after your information. We only collect what we need to run your lessons, we "
        "never sell your data, and a parent or you can ask to see or delete it at any time.",
        "## Who we are\n[COMPANY], [ADDRESS]. Data Protection contact: [DPO_EMAIL].\n\n"
        "## What we collect\nAccount details, learning activity (lessons, progress, assessments), "
        "session audio/transcripts, uploaded materials, and billing records.\n\n"
        "## Why (lawful bases)\nTo provide the service (contract), safeguarding and legal duties "
        "(legal obligation), and service improvement (legitimate interests, balanced for children).\n\n"
        "## Children\nThis service is likely within scope of the UK ICO Age Appropriate Design "
        "(Children's) Code. We apply data-minimisation and privacy-by-default. See the Child Safety "
        "statement.\n\n## Retention\nSee the retention schedule in /docs/compliance.\n\n"
        "## Your rights\nAccess, correction, deletion, export, objection — raise a request from your "
        "account settings.\n\n## Processors\nSee the processor register in /docs/compliance.",
        requires_consent=True,
    ),
    "terms_of_service": _doc(
        "Terms of Service",
        "The rules for using SmartAI Tutor. Be kind, use it for learning, and don't misuse it.",
        "## Your account\nKeep your login safe. You're responsible for activity on your account.\n\n"
        "## Acceptable use\nSee the Acceptable Use Policy.\n\n## AI limitations\nLessons are "
        "AI-generated and may contain errors — see the AI Use notice.\n\n## Payment\nBilling terms "
        "and refunds are covered in the Refund/Cancellation Policy.\n\n## Liability & changes\n"
        "[LIABILITY CLAUSES]. We may update these terms; material changes require re-acceptance.",
        requires_consent=True,
    ),
    "parent_terms": _doc(
        "Parent / Carer Terms",
        "For parents and carers: how booking, payment and your child's data controls work.",
        "## Your authority\nYou confirm you are the parent/carer of the linked child and may consent "
        "on their behalf.\n\n## Controls\nYou can view your child's privacy settings, consents and "
        "progress, and raise data requests on their behalf.\n\n## Billing\nYou are responsible for "
        "payments you authorise. See the Refund/Cancellation Policy.",
        requires_consent=True,
    ),
    "school_terms": _doc(
        "School Terms & Data Processing",
        "For schools/organisations: the agreement and data-processing terms for your tenancy.",
        "## Agreement\n[SCHOOL_AGREEMENT].\n\n## Data processing\nWhere [COMPANY] processes personal "
        "data on the school's behalf, a Data Processing Agreement applies: [DPA_PLACEHOLDER] "
        "(controller/processor roles, sub-processors, security, breach notification, deletion).",
    ),
    "acceptable_use": _doc(
        "Acceptable Use Policy",
        "Use SmartAI Tutor for learning. No bullying, cheating in a harmful way, or misuse.",
        "You agree not to: attempt to break or overload the service; upload unlawful, harmful or "
        "infringing content; harass others; or attempt to extract another user's data. Misuse may "
        "lead to suspension. Report concerns to [SAFETY_EMAIL].",
        requires_consent=True,
    ),
    "safeguarding": _doc(
        "Child Safety & Safeguarding Statement",
        "Your safety matters. If something makes you uncomfortable, tell a trusted adult — and here's "
        "how we help keep you safe.",
        "## Our commitment\nWe design for children's best interests. AI tutoring is monitored for "
        "safety and content is scoped to the curriculum.\n\n## Reporting\nSafeguarding concerns: "
        "[SAFEGUARDING_CONTACT]. In an emergency contact local services.\n\n## Staff & checks\n"
        "[DBS / staff safeguarding policy placeholder].",
    ),
    "cookie_policy": _doc(
        "Cookie Policy",
        "We only use cookies we need to log you in and keep the site working. We ask before using "
        "any others.",
        "## Essential cookies\nUsed for authentication and security — always on.\n\n## Non-essential\n"
        "Any analytics/preference cookies are off by default and only set after you opt in via the "
        "cookie banner. You can change your choice at any time.",
    ),
    "refund_policy": _doc(
        "Refund & Cancellation Policy",
        "How refunds and cancellations work for lessons and subscriptions.",
        "## Subscriptions\nYou can cancel a subscription at any time; it stops at the end of the "
        "current period. [PRO-RATA / STATUTORY RIGHTS placeholder].\n\n## Token purchases\n"
        "[REFUND TERMS].\n\n## Consumer rights\nNothing here removes your UK statutory consumer "
        "rights.",
    ),
    "ai_use_notice": _doc(
        "AI Use & Limitations",
        "Lessons are created by AI. It's smart and helpful, but it can make mistakes — always "
        "double-check important facts.",
        "## What the AI does\nGenerates lessons, questions, feedback and reports aligned to the "
        "curriculum.\n\n## Limitations\nAI can be wrong or incomplete. It is not a substitute for a "
        "qualified teacher, medical, legal or safeguarding advice.\n\n## Human oversight\n"
        "Teachers/parents can review session reports. Report problems to [SUPPORT_EMAIL].",
    ),
    "accessibility_statement": _doc(
        "Accessibility Statement",
        "We want everyone to be able to use SmartAI Tutor.",
        "We aim to meet WCAG 2.1 AA. Known issues and progress: [ACCESSIBILITY_STATUS]. If you have "
        "trouble using any part of the service, contact [SUPPORT_EMAIL] and we'll help.",
    ),
}


async def ensure_seeded(db: AsyncSession) -> None:
    """Idempotently insert the current DRAFT version of each document if missing."""
    existing = {(d.doc_key, d.version) for d in (await db.execute(
        select(LegalDocument).where(LegalDocument.version == CURRENT_VERSION)
    )).scalars().all()}
    changed = False
    for key, tpl in TEMPLATES.items():
        if (key, CURRENT_VERSION) in existing:
            continue
        db.add(LegalDocument(
            doc_key=key, version=CURRENT_VERSION, title=tpl["title"], summary=tpl["summary"],
            content=tpl["content"], requires_consent=tpl["requires_consent"], is_current=True,
            is_draft=True, effective_at=datetime.now(timezone.utc),
        ))
        changed = True
    if changed:
        await db.flush()


async def current_documents(db: AsyncSession) -> list[LegalDocument]:
    await ensure_seeded(db)
    return list((await db.execute(
        select(LegalDocument).where(LegalDocument.is_current == True).order_by(LegalDocument.doc_key)
    )).scalars().all())


async def get_document(db: AsyncSession, doc_key: str) -> Optional[LegalDocument]:
    await ensure_seeded(db)
    return (await db.execute(
        select(LegalDocument).where(LegalDocument.doc_key == doc_key, LegalDocument.is_current == True)
    )).scalar_one_or_none()


async def record_acceptance(db: AsyncSession, user_id: int, doc_key: str, version: str, ip: Optional[str]) -> None:
    exists = (await db.execute(
        select(LegalAcceptance).where(
            LegalAcceptance.user_id == user_id, LegalAcceptance.doc_key == doc_key, LegalAcceptance.version == version,
        )
    )).scalar_one_or_none()
    if exists:
        return
    db.add(LegalAcceptance(user_id=user_id, doc_key=doc_key, version=version, ip_address=ip))
    await db.flush()


async def pending_consents(db: AsyncSession, user_id: int) -> list[dict]:
    """Current consent-required documents the user has NOT accepted at the current version."""
    docs = await current_documents(db)
    consent_docs = [d for d in docs if d.requires_consent]
    accepted = {(a.doc_key, a.version) for a in (await db.execute(
        select(LegalAcceptance).where(LegalAcceptance.user_id == user_id)
    )).scalars().all()}
    return [
        {"doc_key": d.doc_key, "version": d.version, "title": d.title, "summary": d.summary}
        for d in consent_docs if (d.doc_key, d.version) not in accepted
    ]
