"""
puzzles.py — serve generated puzzle media (Nano Banana images + matplotlib graphs).

The generators (image_gen_service / graph_service) write PNGs into settings.puzzle_media_dir
and hand the frontend a `/api/puzzles/media/{name}` URL. This serves them publicly and
framable (they're shown in the session Learn panel), mirroring the rendered-slides route.
"""
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings

router = APIRouter(prefix="/api/puzzles", tags=["puzzles"])

# Names are server-generated (uuid/hash + .png); reject anything else to avoid traversal.
_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+\.png$")


@router.get("/media/{name}")
async def get_puzzle_media(name: str):
    if not _NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Bad media name")
    path = Path(settings.puzzle_media_dir) / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(
        str(path),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400", "Content-Disposition": "inline"},
    )
