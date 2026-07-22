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


def main() -> None:
    from app.services import manim_service as ms
    if not ms.MANIM_AVAILABLE:
        log.warning("Manim isn't installed — nothing to seed. Rebuild the backend with manim first.")
        return
    done = skipped = failed = 0
    for kind, presets in PRESETS.items():
        if kind not in ms.TEMPLATES:
            continue
        for params in presets:
            spec = ms.spec_for(kind, params)
            if not spec:
                continue
            key, clean, _title, _cap = spec
            if ms.cached_path(key):
                skipped += 1
                continue
            log.info("rendering %s %s ...", kind, clean)
            ok = ms._render_sync(kind, clean, key)
            done += int(ok)
            failed += int(not ok)
    log.info("Animation seeding complete: %d rendered, %d already cached, %d failed.",
             done, skipped, failed)


if __name__ == "__main__":
    main()
