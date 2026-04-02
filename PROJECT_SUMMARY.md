# SmartAI Tutor — Project Summary

SmartAI Tutor is an AI-powered tutoring platform built for UK GCSE curriculum (Key Stages 1-5). It provides personalized learning through text chat and real-time voice conversation, grounded in actual course materials via a Retrieval-Augmented Generation (RAG) system. Teachers and admins upload curriculum content (PDF, DOCX, PPTX) organized by Key Stage, subject, exam board, and tier. When students ask questions, the system automatically retrieves relevant document chunks using pgvector similarity search and injects them into the Gemini AI prompt, producing accurate, curriculum-aligned answers.

---

## System Architecture

```
Teacher uploads documents (PDF/DOCX/PPTX)
    |
    v
Text Extraction -> Chunking (500 tokens) -> Gemini Embedding (768d) -> pgvector storage
    |
    v
Student asks question
    |
    v
Embed query -> pgvector cosine search (HNSW index) -> Top-5 chunks retrieved
    |
    v
Chunks injected into Gemini prompt as [KNOWLEDGE BASE CONTEXT]
    |
    v
Gemini 2.5 Flash generates curriculum-grounded response
    |
    v
Streamed to student (text via SSE, voice via Gemini Live API)
```

---

## UK GCSE Curriculum Structure

Documents are organized following the UK national curriculum hierarchy:

| Field | Values | Purpose |
|------------|---------------------------------------------------|----------------------------------------|
| key_stage | KS1, KS2, KS3, KS4, KS5 | Year group level (ages 5-18) |
| subject | Biology, Chemistry, Physics, Maths, English, etc. | Subject area |
| exam_board | AQA, Edexcel, OCR, WJEC, None | GCSE exam board (KS4+) |
| tier | Foundation, Higher, None | Exam difficulty tier |
| unit_name | Free text | E.g. "Eukaryotic and Prokaryotic Cells" |

### Key Stage Reference

| Key Stage | Years | Ages | Level |
|-----------|-------|-------|-------|
| KS1 | 1-2 | 5-7 | Primary |
| KS2 | 3-6 | 7-11 | Primary |
| KS3 | 7-9 | 11-14 | Secondary |
| KS4 | 10-11 | 14-16 | GCSE |
| KS5 | 12-13 | 16-18 | A-Level |

---

## Backend (FastAPI) — `backend/app/`

| Layer | Files | Purpose |
|-----------|------------------------------------------------------|----------------------------------------------|
| Core | `config.py`, `security.py` | Settings, JWT + bcrypt, RAG config |
| DB | `session.py`, `init_db.py` | Async SQLAlchemy + asyncpg, pgvector extension |
| Models | `user.py`, `chat.py`, `subscription.py`, `documents.py` | Users, chats, messages, subscriptions, documents, document_chunks (pgvector) |
| Schemas | `user.py`, `chat.py`, `subscription.py`, `documents.py` | Pydantic request/response validation |
| Services | `user_service.py`, `chat_service.py`, `gemini_service.py`, `voice_service.py`, `credit_service.py`, `embedding_service.py`, `retrieval_service.py`, `document_service.py`, `scraper_service.py` | Business logic |
| Routers | `auth.py`, `chat.py`, `voice.py`, `health.py`, `admin.py`, `teacher.py`, `subscription.py`, `documents.py` | REST, SSE, WebSocket endpoints |
| Middleware | `auth.py`, `rate_limit.py` | JWT guard, role-based access, rate limiting |
| Scripts | `setup.py`, `seed.py` | Database setup and seed data |

### Key Backend Features

- **Multi-role system**: Admin, Teacher, Student with role-based access control
- **RAG pipeline**: pgvector HNSW index, Gemini text-embedding-001, cosine similarity search
- **Document processing**: PDF (pypdf), DOCX (python-docx), PPTX (python-pptx) text extraction, paragraph-aware chunking (500 tokens, 50 overlap), batch embedding
- **Chat**: Gemini 2.5 Flash with streaming (SSE + WebSocket), auto-generated titles, 20-message context window + RAG context injection
- **Voice**: Gemini Live API for real-time bidirectional audio (native STT + TTS), continuous conversation with auto VAD
- **Credit system**: Per-message deduction, subscription plans, transaction audit log
- **Web scraping**: BeautifulSoup-based scraper for thenational.academy, resourcefullearning.co.uk, bbc.co.uk, khanacademy.org
- **Link imports**: OneDrive share links (via share API), Google Docs/Slides export links

---

## Frontend (React + TypeScript + Vite) — `frontend/`

| Layer | Files | Purpose |
|-----------|--------------------------------------------------|----------------------------------------------|
| Context | `AuthContext.tsx` | Global auth state, JWT persistence |
| Hooks | `useChat.ts`, `useVoice.ts` | Chat streaming, real-time voice via WebSocket |
| Services | `api.ts` | API client for all endpoints |
| Pages | `ChatPage`, `LoginPage`, `RegisterPage`, `AdminDashboard`, `TeacherDashboard`, `KnowledgeBasePage` | Role-based pages |
| Components | `Sidebar`, `ChatWindow`, `ChatInput`, `WelcomeScreen` | Reusable UI |

### Key Frontend Features

- **Role-based routing**: `/chat` (student), `/admin` (admin), `/teacher` (teacher)
- **URL-driven chat sessions**: `/chat/:sessionId` with UUID-based session IDs
- **Real-time voice mode**: Mic button opens Gemini Live API WebSocket, continuous audio streaming, auto VAD, live transcripts in chat bubbles, AI audio playback
- **Knowledge Base UI**: Multi-file upload with curriculum metadata (Key Stage, Subject, Exam Board, Tier, Unit), document list with status/retry/delete, web scraping and link import forms
- **Admin dashboard**: User CRUD, credit adjustments, all chats viewer
- **Teacher dashboard**: Student browser, chat history viewer, recent activity feed
- **Unified sidebar**: Same layout across all roles with role-specific navigation

---

## Roles

| Role | Access |
|---------|--------|
| Admin | Full control: manage users, view all chats, adjust credits, manage knowledge base |
| Teacher | Monitor students, view chat histories, upload/manage curriculum documents |
| Student | Chat with AI tutor (text + voice), credit-based usage |

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------------------|---------------------------|
| POST | /api/auth/register | Create student account |
| POST | /api/auth/login | Sign in, receive JWT |
| GET | /api/auth/me | Get current user profile |

### Chat
| Method | Endpoint | Description |
|--------|---------------------------|------------------------------|
| GET | /api/chat/list | List student's chats |
| GET | /api/chat/credits | Get credit balance |
| GET | /api/chat/:sessionId | Get chat with messages |
| POST | /api/chat/stream | Send message (SSE stream) |
| DELETE | /api/chat/:sessionId | Delete a chat |
| WS | /api/chat/ws | WebSocket chat |

### Voice
| Method | Endpoint | Description |
|--------|---------------------------|------------------------------|
| POST | /api/voice/speak | Text-to-speech (gTTS) |
| WS | /api/voice/ws | Real-time voice (Gemini Live) |

### Documents (Knowledge Base)
| Method | Endpoint | Description |
|--------|-------------------------------|------------------------------|
| GET | /api/documents | List documents (filterable) |
| GET | /api/documents/curriculum | Get curriculum metadata |
| POST | /api/documents/upload | Upload PDF/DOCX/PPTX files |
| POST | /api/documents/scrape | Scrape educational URL |
| POST | /api/documents/import-link | Import from OneDrive/GDocs |
| POST | /api/documents/:id/retry | Retry failed processing |
| DELETE | /api/documents/:id | Delete document + chunks |

### Admin
| Method | Endpoint | Description |
|--------|-------------------------------|--------------------------|
| GET | /api/admin/dashboard | Dashboard stats |
| GET | /api/admin/users | List all users |
| POST | /api/admin/users | Create user (any role) |
| PATCH | /api/admin/users/:id | Update user |
| DELETE | /api/admin/users/:id | Delete user |
| POST | /api/admin/users/:id/credits | Adjust credits |
| GET | /api/admin/chats | List all student chats |
| GET | /api/admin/chats/:sessionId | View any chat |

### Teacher
| Method | Endpoint | Description |
|--------|---------------------------------------|--------------------------|
| GET | /api/teacher/dashboard | Dashboard stats |
| GET | /api/teacher/students | List students |
| GET | /api/teacher/students/:id/chats | Student's chat list |
| GET | /api/teacher/chats/:sessionId | View student chat |
| GET | /api/teacher/activity | Recent student questions |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | FastAPI (Python 3.11+) |
| Frontend | React 18 + TypeScript (Vite 6) |
| Database | PostgreSQL 17 + pgvector 0.8.2 |
| AI Model | Google Gemini 2.5 Flash |
| Embeddings | Gemini text-embedding-001 (768d with output_dimensionality) |
| Voice | Gemini Live API (native audio, real-time WebSocket) |
| TTS | gTTS (Google Text-to-Speech) |
| Vector Index | pgvector HNSW (cosine similarity) |
| Auth | JWT + bcrypt |

---

## Default Logins

| Role | Email | Password |
|---------|--------------------------|-------------|
| Admin | admin@smartai.com | admin123 |
| Teacher | teacher@smartai.com | teacher123 |
| Student | student@smartai.com | student123 |
