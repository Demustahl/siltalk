# SilTalk

SilTalk — мессенджер с E2EE (end-to-end encryption).

Идея: сервер **не хранит открытый текст сообщений** — только в зашифрованном виде.
Шифрование выполняется на клиенте.

> Статус: MVP

---

## Возможности

- регистрация и вход в аккаунт
- личный профиль и аватар
- личные и групповые диалоги
- realtime-сообщения через WebSocket
- статусы сообщений: `sent`, `delivered`, `read`
- счетчик непрочитанных сообщений
- поиск пользователей по username
- E2EE на libsodium
- зашифрованные файловые вложения
- приватный ключ хранится только в браузере

## Стек

### Backend
- Python + FastAPI (REST + WebSocket)
- PostgreSQL (хранение пользователей/чатов/сообщений; сообщения — только ciphertext)
- SQLAlchemy + Alembic
- JWT access-токены

### Frontend
- React + Vite
- WebSocket (realtime)
- E2EE: libsodium
- локальный приватный ключ хранится только в браузере

## Структура

- `backend/` — backend на Python и FastAPI
- `frontend/` — React-клиент

## Локальная база данных

По умолчанию backend ожидает PostgreSQL:

```text
postgresql+psycopg://postgres:postgres@localhost:5432/siltalk
```

Пример запуска через Docker:

```bash
docker run --name siltalk-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=siltalk -p 5432:5432 -d postgres:16
```

Если контейнер уже создан:

```bash
docker start siltalk-postgres
```

## Локальный запуск backend

Зависимости backend описаны в `backend/pyproject.toml`

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Swagger UI доступен по адресу `http://127.0.0.1:8000/docs`.

## Локальный запуск frontend

```bash
cd frontend
npm install
npm run dev
```

По умолчанию frontend открывается на `http://127.0.0.1:5173`.

## Проверки

```bash
cd backend
uv run pytest
uv run ruff check .
uv run mypy app
```

```bash
cd frontend
npm run build
```
