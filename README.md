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

## Backend Setup

Зависимости backend теперь описаны в `backend/pyproject.toml`

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Что уже есть в MVP backend:

- `GET /health` -> `{"status": "ok"}`
- `WebSocket /ws` -> сервер возвращает тот же текст обратно (`echo`)

## Как проверить WebSocket вручную

1. Запустить backend:

```bash
cd backend
uv run uvicorn app.main:app --reload
```

2. Открыть в браузере любую страницу и перейти в DevTools -> Console.

3. Выполнить такой код:

```javascript
const ws = new WebSocket("ws://127.0.0.1:8000/ws");

ws.onmessage = (event) => console.log("Ответ сервера:", event.data);
ws.onopen = () => ws.send("Привет");
```

4. В консоли должен появиться ответ:

```text
Ответ сервера: Привет
```

Проверки:

```bash
cd backend
uv run pytest
uv run ruff check .
uv run mypy app
```
