"""
seed_voice_fillers.py
=====================

Pre-generate Kokoro TTS audio for short NEUTRAL bridge phrases ("Okay.",
"Right.", "Let me see.") played the instant a student sends a message, covering
only the <1s gap before the real reply's TTS begins. The contextual reaction
(praise / correction / "let's dive in") now comes from the model's own first
sentence via the segment pipeline, so the old situational-filler classifier was
removed and only the neutral bridge bucket remains.

Think of this like a database seeder / migration: you run it ONCE (and again
whenever you change the phrase catalog). It is idempotent — existing clips are
skipped unless you pass --force.

WHAT IT PRODUCES
----------------
  uploads/voices/<slug>.wav      one WAV per phrase (same voice as the AI: af_sky)
  uploads/voices/manifest.json   catalog get_neutral_filler() reads

HOW TO RUN  (from the backend/ directory, so `app` is importable)
-----------------------------------------------------------------
  python -m app.seed_voice_fillers            # generate missing clips
  python -m app.seed_voice_fillers --force    # regenerate everything
  python -m app.seed_voice_fillers --list     # just print the catalog, generate nothing

In Docker:
  docker compose exec backend python -m app.seed_voice_fillers

Voice continuity: clips are generated with the EXACT same Kokoro voice/speed the
tutor uses (reuses voice_agent_service.text_to_speech), so the filler and the real
answer sound like one continuous teacher, not two different people.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

# NOTE: app.core.config, soundfile + Kokoro (torch) are imported lazily inside the
# functions that
# need them, so `--list` and the catalog/slug logic run even where the heavy TTS
# deps aren't installed (e.g. a bare local venv). Real generation needs the same
# environment as the backend (Docker), where Kokoro + soundfile are available.

# Kokoro language code used by voice_agent_service (must match the voice prefix: "a" for af_*/am_*)
LANG_CODE = "a"
SAMPLE_RATE = 24000


# ---------------------------------------------------------------------------
# Phrase catalog — a single "neutral" bridge bucket.
# Keep phrases GENERIC (no topic words) and neutral (never presume praise or
# correctness) so they're reusable across every lesson and turn.
# ---------------------------------------------------------------------------
FILLER_CATALOG: dict[str, dict] = {
    "neutral": {
        "when": "A tiny neutral bridge played the instant the student sends, covering only the <1s before the real reply begins. Never presumes praise or correctness.",
        "phrases": [
            "Okay.",
            "Right.",
            "Mm-hmm.",
            "Let me see.",
            "One sec.",
            "Alright.",
            "Got it.",
            "Sure.",
        ],
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def slugify(text: str) -> str:
    """Filesystem-safe, human-readable filename stem derived from the phrase.

    "That's a great question." -> "thats-a-great-question"
    """
    # Drop apostrophes (straight + curly) so "that's" -> "thats" not "that-s"
    text = text.replace("'", "").replace("’", "")
    # Strip accents / non-ASCII
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "filler"


def voices_dir() -> Path:
    """uploads/voices/ — sibling of settings.upload_dir (uploads/documents)."""
    from app.core.config import settings  # lazy: avoids loading Settings for --list
    d = Path(settings.upload_dir).resolve().parent / "voices"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _wav_duration_ms(wav_bytes: bytes) -> int:
    import soundfile as sf  # lazy: only needed when generating/measuring
    with sf.SoundFile(io.BytesIO(wav_bytes)) as f:
        return int(round(len(f) / float(f.samplerate) * 1000))


def generate_clip(text: str, out_path: Path) -> int:
    """Render one phrase to a WAV file. Returns its duration in milliseconds."""
    from app.services.voice_agent_service import text_to_speech  # lazy: pulls in Kokoro/torch
    wav_bytes, _mime = text_to_speech(text)  # same af_sky voice as the live tutor
    out_path.write_bytes(wav_bytes)
    return _wav_duration_ms(wav_bytes)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def print_catalog() -> None:
    total = 0
    for category, data in FILLER_CATALOG.items():
        print(f"\n[{category}]  {data['when']}")
        for phrase in data["phrases"]:
            total += 1
            print(f"    {slugify(phrase) + '.wav':<40} {phrase}")
    print(f"\nTotal: {total} phrases across {len(FILLER_CATALOG)} categories.")


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.seed_voice_fillers",
        description="Pre-generate Kokoro TTS filler phrases into uploads/voices/.",
    )
    parser.add_argument("--force", action="store_true", help="Regenerate clips that already exist.")
    parser.add_argument("--list", action="store_true", help="Print the phrase catalog and exit (no audio generated).")
    args = parser.parse_args()

    if args.list:
        print_catalog()
        return 0

    # Heavy imports happen here (not at module top) so --list works without Kokoro.
    from app.services.voice_agent_service import TTS_VOICE, TTS_SPEED, _get_kokoro

    out_dir = voices_dir()
    print(f"Output folder: {out_dir}")
    print(f"Voice: {TTS_VOICE}  speed: {TTS_SPEED}  lang_code: {LANG_CODE}")

    # Warm the pipeline once up front (first load is ~300MB / a few seconds).
    print("Loading Kokoro pipeline...", flush=True)
    t0 = time.time()
    _get_kokoro()
    print(f"Kokoro ready in {time.time() - t0:.1f}s.\n", flush=True)

    manifest_categories: dict[str, dict] = {}
    generated = skipped = failed = 0

    for category, data in FILLER_CATALOG.items():
        phrase_entries = []
        for phrase in data["phrases"]:
            slug = slugify(phrase)
            filename = f"{slug}.wav"
            out_path = out_dir / filename

            if out_path.exists() and not args.force:
                duration_ms = _wav_duration_ms(out_path.read_bytes())
                skipped += 1
                print(f"[skip] {category:<14} {filename:<40} ({duration_ms} ms)")
            else:
                try:
                    t = time.time()
                    duration_ms = generate_clip(phrase, out_path)
                    generated += 1
                    print(f"[gen]  {category:<14} {filename:<40} ({duration_ms} ms, {time.time() - t:.2f}s)")
                except Exception as e:  # noqa: BLE001 - report and keep going
                    failed += 1
                    print(f"[FAIL] {category:<14} {filename:<40} {type(e).__name__}: {e}")
                    continue

            phrase_entries.append({
                "text": phrase,
                "slug": slug,
                "file": filename,
                "duration_ms": duration_ms,
            })

        manifest_categories[category] = {
            "when": data["when"],
            "phrases": phrase_entries,
        }

    manifest = {
        "voice": TTS_VOICE,
        "speed": TTS_SPEED,
        "lang_code": LANG_CODE,
        "sample_rate": SAMPLE_RATE,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": sum(len(c["phrases"]) for c in manifest_categories.values()),
        "categories": manifest_categories,
    }

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "-" * 60)
    print(f"Generated: {generated}   Skipped: {skipped}   Failed: {failed}")
    print(f"Manifest:  {manifest_path}")
    print("Done.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
