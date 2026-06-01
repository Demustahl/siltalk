import asyncio
from collections.abc import Generator

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import create_access_token, hash_password
from app.database import Base, get_db_session
from app.main import app
from app.messages import save_direct_message
from app.models import Message, MessageDeliveryStatus, User


class DialogsTestClient:
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
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        )

    async def __aenter__(self) -> "DialogsTestClient":
        Base.metadata.create_all(bind=self.engine)
        app.dependency_overrides[get_db_session] = self.override_get_db_session
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.client.aclose()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    # Выдает тестовую сессию БД для FastAPI
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

    # Создает заголовок авторизации для пользователя
    def auth_headers(self, user: User) -> dict[str, str]:
        token = create_access_token(user)
        return {"Authorization": f"Bearer {token}"}

    # Сохраняет тестовое сообщение
    def save_message(self, sender: User, receiver: str, ciphertext: str) -> Message:
        with self.session_local() as db_session:
            attached_sender = db_session.get(User, sender.id)
            assert attached_sender is not None

            message = save_direct_message(
                db_session,
                attached_sender,
                receiver,
                ciphertext,
            )
            assert message is not None

            return message

    # Возвращает статусы сообщений из тестовой БД
    def get_delivery_statuses(self) -> list[MessageDeliveryStatus]:
        with self.session_local() as db_session:
            return list(db_session.scalars(select(MessageDeliveryStatus)).all())


def test_read_dialogs_returns_only_current_user_dialogs() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            test_app.create_user("user2")
            user3 = test_app.create_user("user3")

            test_app.save_message(user1, "user2", "ciphertext-hello")
            test_app.save_message(user3, "user2", "ciphertext-hidden")

            response = await test_app.client.get(
                "/dialogs",
                headers=test_app.auth_headers(user1),
            )

            assert response.status_code == 200
            response_data = response.json()
            assert len(response_data) == 1
            assert response_data[0]["dialog_type"] == "direct"
            assert set(response_data[0]["members"]) == {"user1", "user2"}
            member_usernames = {
                profile["username"]
                for profile in response_data[0]["member_profiles"]
            }
            assert member_usernames == {
                "user1",
                "user2",
            }
            assert "password_hash" not in response_data[0]["member_profiles"][0]
            assert response_data[0]["unread_count"] == 0

    asyncio.run(run_test())


def test_read_dialog_messages_returns_history_for_member() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")

            first_message = test_app.save_message(user1, "user2", "ciphertext-hello")
            test_app.save_message(user2, "user1", "ciphertext-answer")

            response = await test_app.client.get(
                f"/dialogs/{first_message.dialog_id}/messages",
                headers=test_app.auth_headers(user1),
            )

            assert response.status_code == 200
            response_data = response.json()
            assert [message["ciphertext"] for message in response_data] == [
                "ciphertext-hello",
                "ciphertext-answer",
            ]
            assert [message["sender_username"] for message in response_data] == [
                "user1",
                "user2",
            ]
            assert [message["status"] for message in response_data] == [
                "sent",
                "sent",
            ]

    asyncio.run(run_test())


def test_saved_message_creates_sent_delivery_status() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")

            message = test_app.save_message(user1, "user2", "ciphertext-hello")

            statuses = test_app.get_delivery_statuses()
            assert len(statuses) == 1
            assert statuses[0].message_id == message.id
            assert statuses[0].user_id == user2.id
            assert statuses[0].status == "sent"

    asyncio.run(run_test())


def test_read_dialogs_returns_unread_count_and_read_endpoint_clears_it() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")

            message = test_app.save_message(user1, "user2", "ciphertext-hello")

            unread_response = await test_app.client.get(
                "/dialogs",
                headers=test_app.auth_headers(user2),
            )

            assert unread_response.status_code == 200
            assert unread_response.json()[0]["id"] == str(message.dialog_id)
            assert unread_response.json()[0]["unread_count"] == 1

            read_response = await test_app.client.post(
                f"/dialogs/{message.dialog_id}/read",
                headers=test_app.auth_headers(user2),
            )

            assert read_response.status_code == 200
            assert read_response.json() == {
                "dialog_id": str(message.dialog_id),
                "marked_read_count": 1,
            }

            read_again_response = await test_app.client.get(
                "/dialogs",
                headers=test_app.auth_headers(user2),
            )

            assert read_again_response.status_code == 200
            assert read_again_response.json()[0]["unread_count"] == 0

            history_response = await test_app.client.get(
                f"/dialogs/{message.dialog_id}/messages",
                headers=test_app.auth_headers(user1),
            )

            assert history_response.status_code == 200
            assert history_response.json()[0]["status"] == "read"

    asyncio.run(run_test())


def test_read_dialog_messages_uses_limit() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            test_app.create_user("user2")

            first_message = test_app.save_message(user1, "user2", "ciphertext-first")
            test_app.save_message(user1, "user2", "ciphertext-second")

            response = await test_app.client.get(
                f"/dialogs/{first_message.dialog_id}/messages?limit=1",
                headers=test_app.auth_headers(user1),
            )

            assert response.status_code == 200
            assert len(response.json()) == 1
            assert response.json()[0]["ciphertext"] == "ciphertext-first"

    asyncio.run(run_test())


def test_read_dialog_messages_returns_not_found_for_not_member() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            test_app.create_user("user2")
            user3 = test_app.create_user("user3")

            message = test_app.save_message(user1, "user2", "ciphertext-hello")

            response = await test_app.client.get(
                f"/dialogs/{message.dialog_id}/messages",
                headers=test_app.auth_headers(user3),
            )

            assert response.status_code == 404

    asyncio.run(run_test())


def test_read_dialogs_requires_token() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            response = await test_app.client.get("/dialogs")

            assert response.status_code == 401

    asyncio.run(run_test())
