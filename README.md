# SilTalk

SilTalk — мессенджер с E2EE (end-to-end encryption).

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

## Структура

- `backend/` — backend на Python и FastAPI
- `frontend/` — будущий клиент
- `infra/` — инфраструктурные файлы и локальный запуск

## Локальный запуск backend

Зависимости backend описаны в `backend/pyproject.toml`

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

## Проверки

```bash
cd backend
uv run pytest
uv run ruff check .
uv run mypy app
```
