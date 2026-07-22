"""
Pre-render the common Manim animations into the cache, so the FIRST time the tutor asks for one
it's already there (no "rendering, not ready yet" miss).

Run after building the backend with manim:  python -m app.seed_animations

Safe to re-run — anything already cached is skipped. No-op (with a clear message) if manim isn't
installed.
"""
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("seed_animations")

# The presets the tutor is most likely to ask for.
PRESETS = {
    "sine_wave": [{"cycles": 2}, {"cycles": 1}],
    "vector_addition": [{"ax": 3, "ay": 1, "bx": 1, "by": 2}, {"ax": 2, "ay": 2, "bx": 2, "by": -1}],
    "number_line_add": [{"start": 3, "step": 2, "jumps": 4}, {"start": 0, "step": 5, "jumps": 3}],
}


BATCH_SIZE = 128


def main() -> None:
    from app.services import manim_service as ms
    if not ms.MANIM_AVAILABLE:
        log.warning("Manim isn't installed — nothing to seed. Rebuild the backend with manim first.")
        return

    # Flatten to a work list first so it can be batched (and counted) the same way the
    # explanatory-image seeder is.
    work = []
    for kind, presets in PRESETS.items():
        if kind not in ms.TEMPLATES:
            continue
        for params in presets:
            spec = ms.spec_for(kind, params)
            if spec:
                work.append((kind, spec))

    done = skipped = failed = 0
    total = len(work)
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE or 1
    for b in range(n_batches):
        chunk = work[b * BATCH_SIZE:(b + 1) * BATCH_SIZE]
        b_done = b_skip = b_fail = 0
        log.info("── batch %d/%d (%d items) ──", b + 1, n_batches, len(chunk))
        for kind, (key, clean, _title, _cap) in chunk:
            if ms.cached_path(key):
                skipped += 1; b_skip += 1
                continue
            log.info("rendering %s %s ...", kind, clean)
            ok = ms._render_sync(kind, clean, key)
            done += int(ok); failed += int(not ok)
            b_done += int(ok); b_fail += int(not ok)
        # Each MP4 is moved into the cache as it finishes, so a batch boundary is simply a
        # checkpoint — everything so far is durable and the run is safe to stop/resume here.
        log.info("── batch %d/%d done: %d rendered, %d cached, %d failed "
                 "(running total: %d rendered of %d) ──",
                 b + 1, n_batches, b_done, b_skip, b_fail, done, total)

    log.info("Animation seeding complete: %d rendered, %d already cached, %d failed.",
             done, skipped, failed)


if __name__ == "__main__":
    main()
