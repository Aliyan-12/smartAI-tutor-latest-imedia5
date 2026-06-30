"""
seed_topic_images.py
====================

Populate the topic-image catalog (`rh_topic_images`) — one representative image per
curriculum topic, resolved from Wikipedia lead images and cached so puzzles
(match / identify / curated labelling) can illustrate most topics for every KS/Year.

Run it ONCE after the curriculum has synced (so `rh_topics` is populated), and again
whenever you want to fill in newly-added topics. It is idempotent: topics already
resolved (status='ok') are skipped unless you pass --force.

HOW TO RUN  (from the backend/ directory, so `app` is importable)
-----------------------------------------------------------------
  python -m app.seed_topic_images               # resolve missing topics
  python -m app.seed_topic_images --force       # re-resolve everything
  python -m app.seed_topic_images --limit 50    # only the first 50 (smoke test)

In Docker:
  docker compose exec backend python -m app.seed_topic_images

Needs network access to en.wikipedia.org and a populated rh_topics table (run the
curriculum sync first). Requires the same DB env as the backend.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.seed_topic_images",
        description="Resolve + cache a representative image per curriculum topic.",
    )
    parser.add_argument("--force", action="store_true",
                        help="Re-resolve topics already cached (status='ok').")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only resolve the first N pending topics (smoke test).")
    args = parser.parse_args()

    # Surface the service's INFO logs (progress) on the console — without this the run
    # looks frozen because the work logs via `logger`, not print().
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    from app.services.resource_sync_service import sync_topic_images

    t0 = time.time()

    def _progress(done: int, total: int, counts: dict) -> None:
        pct = (done / total * 100) if total else 100
        print(f"  …{done}/{total} ({pct:.0f}%)  "
              f"resolved={counts.get('resolved', 0)} none={counts.get('none', 0)} "
              f"error={counts.get('error', 0)}  [{time.time() - t0:.0f}s]", flush=True)

    print("Resolving topic images (Wikipedia) — commits in batches, safe to re-run if "
          "interrupted. This can take a few minutes for a full curriculum…", flush=True)
    state = asyncio.run(sync_topic_images(force=args.force, limit=args.limit, on_progress=_progress))
    counts = state.get("counts", {})
    err = state.get("last_error")
    print("\n" + "-" * 60)
    print(f"Topic images — resolved: {counts.get('resolved', 0)}   "
          f"none: {counts.get('none', 0)}   error: {counts.get('error', 0)}   "
          f"skipped: {counts.get('skipped', 0)}   total: {counts.get('total', 0)}")
    if err:
        print(f"ERROR: {err}")
    print("Done.")
    return 1 if err else 0


if __name__ == "__main__":
    sys.exit(main())
