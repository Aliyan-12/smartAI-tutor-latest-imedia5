# syntax=docker/dockerfile:1
# Base pinned by digest so the moving `python:3.11-slim` tag can't silently change
# underneath us and invalidate every layer below (apt + the heavy torch/CUDA/kokoro
# pip layer). Bump this digest deliberately when you want base-image security updates.
FROM python:3.11-slim@sha256:f9fa7f851e38bfb19c9de3afbc4b86ae7176ea7aaf94535c31df5458d5849457

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libreoffice-impress \
    libreoffice-writer \
    fonts-dejavu \
    fonts-liberation \
    # ── Manim animation renderer (cairo/pango vector graphics + ffmpeg video). The scenes label
    #    with Pango Text rather than MathTex, so the huge `texlive` package isn't needed here —
    #    a ~150 MB add instead of ~1 GB. This is only about the VIDEO renderer; LaTeX equations
    #    in puzzles are rendered by KaTeX in the browser and are unaffected. ──
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# BuildKit cache mount persists pip's download cache (the multi-GB torch /
# nvidia-cuda-* / kokoro wheels) across builds. If this layer ever rebuilds (e.g.
# requirements.txt changes, or the base digest is bumped) pip reuses the cached
# wheels instead of re-downloading them. The cache lives in the mount, not the
# image layer, so the final image stays slim (no --no-cache-dir needed).
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY . .

EXPOSE 8001

# WebSocket keepalive: long session turns (slow CPU TTS) must not be dropped by
# uvicorn's default 20s ws ping timeout — matches the voice-WS requirement.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload", \
     "--ws-ping-interval", "30", "--ws-ping-timeout", "300", "--timeout-keep-alive", "300"]
