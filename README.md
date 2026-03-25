# SmartAI Tutor

AI-powered tutoring platform for K-12 students with chat, streaming responses, and voice support.

## Tech Stack

- **Backend:** FastAPI (Python 3.11+)
- **Frontend:** React 18 + TypeScript (Vite)
- **Database:** PostgreSQL 16 with pgvector
- **AI:** Google Gemini API
- **Voice:** gTTS (text-to-speech), Whisper (speech-to-text)
- **Infrastructure:** Docker & Docker Compose

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── core/          # Config, security utilities
│   │   ├── db/            # Database session, initialization
│   │   ├── middleware/     # Auth guards, rate limiting
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── routers/       # API route handlers
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # Business logic (chat, gemini, voice)
│   │   └── main.py        # FastAPI application entry
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── context/       # React context (auth)
│   │   ├── hooks/         # Custom hooks (chat, voice)
│   │   ├── pages/         # Page components
│   │   ├── services/      # API client
│   │   ├── styles/        # CSS
│   │   └── types/         # TypeScript interfaces
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env
└── .env.example
```

## Setup

### Prerequisites

- Docker & Docker Compose
- Google Gemini API key ([get one here](https://aistudio.google.com/apikey))

### Quick Start (Docker)

1. Clone and configure environment:

```bash
cp .env.example .env
```

2. Set your Gemini API key in `.env`:

```
GEMINI_API_KEY=your_actual_api_key
```

3. Start all services:

```bash
docker-compose up --build
```

4. Access the app:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8001
   - API Docs: http://localhost:8001/docs

### Local Development (without Docker)

**Backend:**

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Set environment variables or create backend/.env
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server runs on port 5173 and proxies API calls to the backend on port 8001.

**Database:**

```bash
# Run PostgreSQL with pgvector
docker run -d --name smartai-db \
  -e POSTGRES_USER=smartai \
  -e POSTGRES_PASSWORD=smartai_secret_2024 \
  -e POSTGRES_DB=smartai_tutor \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

## API Endpoints

| Method | Endpoint              | Description                |
|--------|-----------------------|----------------------------|
| POST   | /api/auth/register    | Create new user account    |
| POST   | /api/auth/login       | Sign in, receive JWT       |
| GET    | /api/auth/me          | Get current user profile   |
| GET    | /api/chat/list        | List user's chats          |
| GET    | /api/chat/{id}        | Get chat with messages     |
| POST   | /api/chat/send        | Send message (non-stream)  |
| POST   | /api/chat/stream      | Send message (SSE stream)  |
| WS     | /api/chat/ws          | WebSocket chat endpoint    |
| DELETE | /api/chat/{id}        | Delete a chat              |
| POST   | /api/voice/speak      | Text-to-speech (MP3)       |
| POST   | /api/voice/transcribe | Speech-to-text (upload)    |
| GET    | /api/health           | Health check               |

## Environment Variables

| Variable                | Description                          |
|-------------------------|--------------------------------------|
| POSTGRES_USER           | Database username                    |
| POSTGRES_PASSWORD       | Database password                    |
| POSTGRES_DB             | Database name                        |
| POSTGRES_HOST           | Database host (use `db` in Docker)   |
| GEMINI_API_KEY          | Google Gemini API key                |
| GEMINI_MODEL            | Gemini model name                    |
| JWT_SECRET_KEY          | Secret for JWT token signing         |
| JWT_EXPIRATION_MINUTES  | Token expiry in minutes              |
| BACKEND_CORS_ORIGINS    | Comma-separated allowed origins      |
