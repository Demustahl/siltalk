# SilTalk

SilTalk — учебный мессенджер с упором на E2EE (end-to-end encryption).
Цель проекта: бакалаврская работа + портфолио backend-разработчика на Python.

Идея: сервер **не хранит открытый текст сообщений** — только в зашифрованном виде.
Шифрование выполняется на клиенте.

> Статус: в активной разработке (MVP)

---

## Стек (планируемый)

### Backend
- Python + FastAPI (REST + WebSocket)
- PostgreSQL (хранение пользователей/чатов/сообщений; сообщения — только ciphertext)
- Redis (оффлайн-очередь, presence) — подключается по мере необходимости
- SQLAlchemy + Alembic
- JWT (access + refresh)
- Docker Compose

### Frontend
- React + TypeScript (PWA)
- WebSocket (realtime)
- IndexedDB (локальное хранилище)
- E2EE: libsignal (или другой подход на базе libsodium/WebCrypto — уточняется)

## Backend Setup

Зависимости backend теперь описаны в `backend/pyproject.toml`

```bash
cd backend
uv sync
uv run uvicorn siltalk_api.main:app --reload
```

Проверки:

```bash
cd backend
uv run pytest
uv run ruff check .
uv run mypy src
```
