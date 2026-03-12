# SilTalk

SilTalk — учебный мессенджер с упором на E2EE (end-to-end encryption).
Цель проекта: бакалаврская работа + портфолио backend-разработчика на Python.

Идея: сервер **не хранит открытый текст сообщений** — только “непрозрачный payload” (ciphertext).
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