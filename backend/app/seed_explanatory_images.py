"""
Pre-generate the explanatory teaching images for every curriculum topic (and subtopic), so
lessons serve a checked image INSTANTLY instead of paying for a fresh ~5-10 s generation whose
labelling varies each time.

Covers every key stage / year group present in the Resource Hub mirror.

    python -m app.seed_explanatory_images                 # units only (fast, ~220 images)
    python -m app.seed_explanatory_images --subtopics     # units + subtopics (~1450 images)
    python -m app.seed_explanatory_images --limit 50      # do a batch at a time
    python -m app.seed_explanatory_images --subject Maths --key-stage KS3
    python -m app.seed_explanatory_images --overwrite     # regenerate existing

Safe to re-run and safe to interrupt — anything already on disk is skipped, so it resumes.
Images land in the same served media dir as live puzzle images, keyed by curriculum coordinates
(see image_gen_service.topic_key), so `topic_image_url()` finds them at lesson time.
"""
import argparse
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("seed_explanatory_images")


async def _targets(subject: str | None, key_stage: str | None, with_subtopics: bool):
    """(subject, key_stage, year_group, unit_title, subtopic_title|None) for the whole mirror."""
    from sqlalchemy import select
    from app.db.session import async_session_factory
    from app.models.resource_hub import RHUnit, RHSubject, RHTopic, RHAvailability

    out = []
    async with async_session_factory() as db:
        subjects = {s.hub_id: s.name for s in (await db.execute(select(RHSubject))).scalars()}
        units = (await db.execute(select(RHUnit))).scalars().all()
        # (key_stage, year_group) each unit is actually taught in — so we seed per KS/YG.
        edges = (await db.execute(
            select(RHAvailability.unit_hub_id, RHAvailability.key_stage, RHAvailability.year_group)
            .where(RHAvailability.unit_hub_id.isnot(None))
        )).all()
        by_unit: dict = {}
        for uid, ks, yg in edges:
            by_unit.setdefault(uid, set()).add((ks, yg))

        subs_by_unit: dict = {}
        if with_subtopics:
            for t in (await db.execute(select(RHTopic))).scalars():
                subs_by_unit.setdefault(t.unit_hub_id, []).append(t)

        # DEDUPE by the image key. The same unit title is taught in several year groups of one
        # key stage ("UNIT 2: Addition & Subtraction" runs in Years 3-6 of KS2), and the image key
        # is subject|key_stage|unit|subtopic — so without this the identical file is generated
        # once per year group and overwritten each time (12 wasted generations on a units-only
        # run, 16 with subtopics). Keying by year group instead would be worse: the prompt pitches
        # by KEY STAGE, so those extra images would be near-identical at several times the cost.
        from app.services.image_gen_service import topic_key
        seen: set = set()

        def _add(subj, ks, yg, unit, sub):
            k = topic_key(subj, ks, unit, sub)
            if k in seen:
                return
            seen.add(k)
            out.append((subj, ks, yg, unit, sub))

        for u in units:
            subj = subjects.get(u.subject_hub_id) or ""
            if subject and subject.lower() not in subj.lower():
                continue
            placements = by_unit.get(u.hub_id) or {(None, None)}
            for ks, yg in sorted(placements, key=lambda x: (x[0] or "", x[1] or "")):
                if key_stage and (ks or "").upper() != key_stage.upper():
                    continue
                _add(subj, ks, yg, u.title, None)
                for t in sorted(subs_by_unit.get(u.hub_id, []), key=lambda x: (x.position or 0, x.id)):
                    _add(subj, ks, yg, u.title, t.title)
    return out


async def _content_map() -> dict:
    """(unit_title, subtopic_title|None) → real slide/worksheet text for that topic.

    Grounding each image in what the lesson ACTUALLY teaches is what stops the model guessing
    from a bare title. Built in one pass; the unit-level entry is the concatenation of its
    subtopics' text so a unit image reflects the whole deck.
    """
    from sqlalchemy import select
    from app.db.session import async_session_factory
    from app.models.resource_hub import RHResource, RHDocument, RHDocumentChunk

    per_topic: dict = {}
    per_unit: dict = {}
    async with async_session_factory() as db:
        rows = (await db.execute(
            select(RHResource.unit_title, RHResource.topic_title, RHDocumentChunk.content)
            .join(RHDocument, RHDocument.resource_id == RHResource.id)
            .join(RHDocumentChunk, RHDocumentChunk.rh_document_id == RHDocument.id)
            .order_by(RHDocumentChunk.chunk_index)
        )).all()
    for unit, topic, content in rows:
        if not content:
            continue
        # cap what we accumulate — clean_source_text trims again at prompt time
        if topic:
            cur = per_topic.setdefault((unit, topic), [])
            if sum(len(x) for x in cur) < 4000:
                cur.append(content)
        cur_u = per_unit.setdefault(unit, [])
        if sum(len(x) for x in cur_u) < 4000:
            cur_u.append(content)

    out = {(u, t): " ".join(v) for (u, t), v in per_topic.items()}
    for u, v in per_unit.items():
        out[(u, None)] = " ".join(v)
    return out


async def main_async(args) -> None:
    from app.services import image_gen_service as igs

    targets = await _targets(args.subject, args.key_stage, args.subtopics)
    if args.limit:
        # Skip what's already done first, so --limit always does `limit` NEW images. Must use the
        # EXACT check, not topic_image_url — that one falls back subtopic → unit, which would make
        # every unseeded subtopic look complete just because its unit image exists.
        pending = [t for t in targets
                   if args.overwrite or not igs.topic_image_exists(t[0], t[1], t[3], t[4])]
        targets = pending[: args.limit]

    content = {} if args.no_content else await _content_map()
    log.info("targets: %d (subtopics=%s, grounded-in-resource-text=%s, batch=%d)",
             len(targets), args.subtopics, not args.no_content, args.batch_size)

    created = cached = failed = 0
    total = len(targets)
    bs = max(1, args.batch_size)
    n_batches = (total + bs - 1) // bs

    for b in range(n_batches):
        chunk = targets[b * bs:(b + 1) * bs]
        b_created = b_cached = b_failed = 0
        log.info("── batch %d/%d (%d items) ──", b + 1, n_batches, len(chunk))
        for j, (subj, ks, yg, unit, sub) in enumerate(chunk, 1):
            i = b * bs + j
            src = content.get((unit, sub)) or content.get((unit, None)) or ""
            status, _url = await igs.ensure_topic_image(
                subj, ks, unit, sub, overwrite=args.overwrite, source_text=src,
            )
            if status == "created":
                created += 1; b_created += 1
                log.info("[%d/%d] created  %s · %s%s", i, total, subj, unit[:52],
                         f" › {sub[:40]}" if sub else "")
            elif status == "cached":
                cached += 1; b_cached += 1
            else:
                failed += 1; b_failed += 1
                log.warning("[%d/%d] FAILED   %s · %s%s", i, total, subj, unit[:52],
                            f" › {sub[:40]}" if sub else "")
            if args.delay and status == "created":
                await asyncio.sleep(args.delay)   # be gentle with the image API

        # Every image is written to disk the moment it is generated, so a batch boundary is a
        # natural checkpoint: progress so far is already durable and the run can be stopped or
        # resumed here without losing anything.
        log.info("── batch %d/%d done: %d created, %d cached, %d failed "
                 "(running total: %d created / %d of %d) ──",
                 b + 1, n_batches, b_created, b_cached, b_failed, created, cached + created, total)
        if args.batch_pause and b + 1 < n_batches:
            log.info("pausing %.1fs before the next batch…", args.batch_pause)
            await asyncio.sleep(args.batch_pause)

    log.info("Done: %d created, %d already cached, %d failed.", created, cached, failed)


def main() -> None:
    p = argparse.ArgumentParser(description="Pre-generate explanatory topic images.")
    p.add_argument("--subtopics", action="store_true", help="also seed every subtopic")
    p.add_argument("--limit", type=int, default=0, help="only generate this many NEW images")
    p.add_argument("--subject", default=None, help="restrict to a subject, e.g. Maths")
    p.add_argument("--key-stage", dest="key_stage", default=None, help="restrict to e.g. KS3")
    p.add_argument("--overwrite", action="store_true", help="regenerate images that already exist")
    p.add_argument("--delay", type=float, default=0.0, help="seconds to pause between generations")
    p.add_argument("--batch-size", dest="batch_size", type=int, default=128,
                   help="process in batches of this many (default 128); each batch is a checkpoint")
    p.add_argument("--batch-pause", dest="batch_pause", type=float, default=0.0,
                   help="seconds to pause between batches")
    p.add_argument("--no-content", dest="no_content", action="store_true",
                   help="don't ground prompts in the real slide/worksheet text")
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
