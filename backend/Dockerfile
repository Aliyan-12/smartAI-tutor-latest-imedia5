FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

# WebSocket keepalive: long session turns (slow CPU TTS) must not be dropped by
# uvicorn's default 20s ws ping timeout — matches the voice-WS requirement.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload", \
     "--ws-ping-interval", "30", "--ws-ping-timeout", "300", "--timeout-keep-alive", "300"]
