import asyncio
import json
import uuid
from collections.abc import Generator
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import create_access_token, hash_password
from app.database import Base, get_db_session
from app.main import app
from app.models import DialogMember, Message, User
from app.realtime import manager


class WebSocketTestApp:
    def __init__(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_local = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )

    async def __aenter__(self) -> "WebSocketTestApp":
        Base.metadata.create_all(bind=self.engine)
        app.dependency_overrides[get_db_session] = self.override_get_db_session
        return self

    async def __aexit__(self, *args: object) -> None:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    # Выдает тестовую сессию БД для WebSocket-ручки
    def override_get_db_session(self) -> Generator[Session]:
        db_session = self.session_local()
        try:
            yield db_session
        finally:
            db_session.close()

    # Создает пользователя в тестовой БД
    def create_user(self, username: str) -> User:
        with self.session_local() as db_session:
            user = User(
                username=username,
                password_hash=hash_password("secret-password"),
            )
            db_session.add(user)
            db_session.commit()
            db_session.refresh(user)

            return user

    # Создает пользователя и возвращает token
    def create_token(self, username: str) -> str:
        user = self.create_user(username)
        return create_access_token(user)

    # Возвращает сохраненные сообщения
    def get_messages(self) -> list[Message]:
        with self.session_local() as db_session:
            return list(db_session.scalars(select(Message)).all())

    # Возвращает usernames участников диалога
    def get_dialog_member_usernames(self, dialog_id: uuid.UUID) -> set[str]:
        with self.session_local() as db_session:
            statement = (
                select(User.username)
                .join(DialogMember, DialogMember.user_id == User.id)
                .where(DialogMember.dialog_id == dialog_id)
            )
            return set(db_session.scalars(statement).all())


class WebSocketSession:
    def __init__(self, url: str) -> None:
        parsed_url = urlsplit(url)
        self.path = parsed_url.path
        self.query_string = parsed_url.query.encode()
        self.to_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.from_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.task: asyncio.Task[None] | None = None

    async def __aenter__(self) -> "WebSocketSession":
        await self.connect()
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def connect(self) -> None:
        scope = {
            "type": "websocket",
            "asgi": {"version": "3.0"},
            "path": self.path,
            "raw_path": self.path.encode(),
            "root_path": "",
            "scheme": "ws",
            "query_string": self.query_string,
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
            "subprotocols": [],
        }

        self.task = asyncio.create_task(app(scope, self.to_app.get, self.from_app.put))
        await self.to_app.put({"type": "websocket.connect"})

        message = await asyncio.wait_for(self.from_app.get(), timeout=1)
        assert message["type"] == "websocket.accept"

    async def send_text(self, text: str) -> None:
        await self.to_app.put({"type": "websocket.receive", "text": text})

    async def send_json(self, data: dict[str, str]) -> None:
        await self.send_text(json.dumps(data))

    async def receive_json(self) -> dict[str, str]:
        message = await asyncio.wait_for(self.from_app.get(), timeout=1)
        assert message["type"] == "websocket.send"

        if "text" in message:
            return json.loads(message["text"])

        return json.loads(message["bytes"].decode())

    async def close(self) -> None:
        if self.task is None or self.task.done():
            return

        await self.to_app.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, timeout=1)


def setup_function() -> None:
    manager.active_connections.clear()


def test_websocket_connects_with_token() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp() as test_app:
            user1_token = test_app.create_token("user1")

            async with WebSocketSession(f"/ws?token={user1_token}"):
                pass

    asyncio.run(run_test())


def test_websocket_sends_message_to_other_client() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp() as test_app:
            user1_token = test_app.create_token("user1")
            user2_token = test_app.create_token("user2")

            async with (
                WebSocketSession(f"/ws?token={user1_token}") as user1,
                WebSocketSession(f"/ws?token={user2_token}") as user2,
            ):
                await user1.send_json(
                    {
                        "type": "message",
                        "to": "user2",
                        "ciphertext": "ciphertext-hello",
                    }
                )

                assert await user2.receive_json() == {
                    "type": "message",
                    "from": "user1",
                    "ciphertext": "ciphertext-hello",
                }

                await user1.send_json(
                    {
                        "type": "message",
                        "to": "user2",
                        "ciphertext": "ciphertext-second",
                    }
                )

                assert await user2.receive_json() == {
                    "type": "message",
                    "from": "user1",
                    "ciphertext": "ciphertext-second",
                }

            saved_messages = test_app.get_messages()
            assert len(saved_messages) == 2
            assert {message.ciphertext for message in saved_messages} == {
                "ciphertext-hello",
                "ciphertext-second",
            }
            assert len({message.dialog_id for message in saved_messages}) == 1
            assert test_app.get_dialog_member_usernames(
                saved_messages[0].dialog_id
            ) == {"user1", "user2"}

    asyncio.run(run_test())


def test_websocket_returns_error_for_bad_json() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp() as test_app:
            user1_token = test_app.create_token("user1")

            async with WebSocketSession(f"/ws?token={user1_token}") as websocket:
                await websocket.send_text("not json")

                assert await websocket.receive_json() == {
                    "type": "error",
                    "text": "Некорректный JSON или формат сообщения",
                }

    asyncio.run(run_test())


def test_websocket_rejects_message_without_ciphertext() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp() as test_app:
            user1_token = test_app.create_token("user1")
            test_app.create_user("user2")

            async with WebSocketSession(f"/ws?token={user1_token}") as websocket:
                await websocket.send_json(
                    {"type": "message", "to": "user2", "text": "plain text"}
                )

                assert await websocket.receive_json() == {
                    "type": "error",
                    "text": "Некорректный JSON или формат сообщения",
                }

            assert test_app.get_messages() == []

    asyncio.run(run_test())


def test_websocket_returns_error_when_receiver_is_offline() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp() as test_app:
            user1_token = test_app.create_token("user1")
            test_app.create_user("user2")

            async with WebSocketSession(f"/ws?token={user1_token}") as websocket:
                await websocket.send_json(
                    {
                        "type": "message",
                        "to": "user2",
                        "ciphertext": "ciphertext-hello",
                    }
                )

                assert await websocket.receive_json() == {
                    "type": "error",
                    "text": "Получатель не подключен",
                }

            saved_messages = test_app.get_messages()
            assert len(saved_messages) == 1
            assert saved_messages[0].ciphertext == "ciphertext-hello"

    asyncio.run(run_test())


def test_websocket_returns_error_when_receiver_does_not_exist() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp() as test_app:
            user1_token = test_app.create_token("user1")

            async with WebSocketSession(f"/ws?token={user1_token}") as websocket:
                await websocket.send_json(
                    {
                        "type": "message",
                        "to": "user2",
                        "ciphertext": "ciphertext-hello",
                    }
                )

                assert await websocket.receive_json() == {
                    "type": "error",
                    "text": "Получатель не найден",
                }

            assert test_app.get_messages() == []

    asyncio.run(run_test())


def test_websocket_returns_error_without_token() -> None:
    async def run_test() -> None:
        async with WebSocketSession("/ws") as websocket:
            assert await websocket.receive_json() == {
                "type": "error",
                "text": "Нужно передать token в query params",
            }

    asyncio.run(run_test())


def test_websocket_returns_error_for_bad_token() -> None:
    async def run_test() -> None:
        async with WebSocketTestApp():
            async with WebSocketSession("/ws?token=bad-token") as websocket:
                assert await websocket.receive_json() == {
                    "type": "error",
                    "text": "Некорректный token",
                }


    asyncio.run(run_test())
