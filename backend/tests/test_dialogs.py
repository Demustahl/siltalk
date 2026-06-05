import asyncio
import uuid
from collections.abc import Generator
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import create_access_token, hash_password
from app.database import Base, get_db_session
from app.main import app
from app.messages import save_dialog_message, save_direct_message
from app.models import (
    DeviceKey,
    Dialog,
    DialogMember,
    Message,
    MessageDeliveryStatus,
    User,
    UserDevice,
)


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

    def publish_public_key(self, user: User, public_key: str | None = None) -> None:
        with self.session_local() as db_session:
            device = UserDevice(user_id=user.id, name="browser")
            db_session.add(device)
            db_session.flush()
            db_session.add(
                DeviceKey(
                    device_id=device.id,
                    identity_key_public=public_key or "A" * 44,
                )
            )
            db_session.commit()

    def create_group_dialog(self, users: list[User], title: str = "Team") -> Dialog:
        with self.session_local() as db_session:
            dialog = Dialog(dialog_type="group", title=title)
            db_session.add(dialog)
            db_session.flush()
            db_session.add_all(
                [
                    DialogMember(dialog_id=dialog.id, user_id=user.id)
                    for user in users
                ]
            )
            db_session.commit()
            db_session.refresh(dialog)

            return dialog

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

    def save_group_message(
        self,
        sender: User,
        dialog_id: uuid.UUID,
        ciphertext: str,
    ) -> Message:
        with self.session_local() as db_session:
            attached_sender = db_session.get(User, sender.id)
            assert attached_sender is not None

            message = save_dialog_message(
                db_session,
                attached_sender,
                dialog_id,
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
            assert response_data[0]["last_message"]["sender_username"] == "user1"
            assert response_data[0]["last_message"]["ciphertext"] == "ciphertext-hello"

    asyncio.run(run_test())


def test_group_messages_use_save_time_for_ordering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)

        return value

    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")
            dialog = test_app.create_group_dialog([user1, user2])
            first_time = datetime(2026, 6, 5, 8, 0, 0, tzinfo=timezone.utc)
            second_time = datetime(2026, 6, 5, 8, 5, 0, tzinfo=timezone.utc)
            save_times = iter([first_time, second_time])

            monkeypatch.setattr("app.messages.utc_now", lambda: next(save_times))

            first_message = test_app.save_group_message(
                user1,
                dialog.id,
                "ciphertext-first",
            )
            second_message = test_app.save_group_message(
                user2,
                dialog.id,
                "ciphertext-second",
            )

            assert as_utc(first_message.created_at) == first_time
            assert as_utc(second_message.created_at) == second_time

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


def test_create_group_dialog_requires_public_keys_and_returns_member_keys() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")
            user3 = test_app.create_user("user3")

            test_app.publish_public_key(user1, "A" * 44)
            test_app.publish_public_key(user2, "B" * 44)

            missing_key_response = await test_app.client.post(
                "/dialogs/groups",
                headers=test_app.auth_headers(user1),
                json={
                    "title": "Project team",
                    "member_usernames": ["user2", "user3"],
                },
            )

            assert missing_key_response.status_code == 409

            test_app.publish_public_key(user3, "C" * 44)

            create_response = await test_app.client.post(
                "/dialogs/groups",
                headers=test_app.auth_headers(user1),
                json={
                    "title": "Project team",
                    "member_usernames": ["user2", "user3"],
                },
            )

            assert create_response.status_code == 201
            response_data = create_response.json()
            assert response_data["dialog_type"] == "group"
            assert response_data["title"] == "Project team"
            assert set(response_data["members"]) == {"user1", "user2", "user3"}
            assert response_data["unread_count"] == 0
            assert response_data["last_message"] is None

            keys_response = await test_app.client.get(
                f"/dialogs/{response_data['id']}/keys",
                headers=test_app.auth_headers(user1),
            )

            assert keys_response.status_code == 200
            assert {
                key_data["username"]
                for key_data in keys_response.json()
            } == {"user1", "user2", "user3"}

    asyncio.run(run_test())


def test_group_unread_count_and_sender_status_are_per_recipient() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")
            user3 = test_app.create_user("user3")
            dialog = test_app.create_group_dialog([user1, user2, user3])
            message = test_app.save_group_message(
                user1,
                dialog.id,
                "ciphertext-group",
            )

            user2_dialogs = await test_app.client.get(
                "/dialogs",
                headers=test_app.auth_headers(user2),
            )

            assert user2_dialogs.status_code == 200
            assert user2_dialogs.json()[0]["id"] == str(dialog.id)
            assert user2_dialogs.json()[0]["unread_count"] == 1

            user2_read_response = await test_app.client.post(
                f"/dialogs/{dialog.id}/read",
                headers=test_app.auth_headers(user2),
            )

            assert user2_read_response.status_code == 200
            assert user2_read_response.json()["marked_read_count"] == 1

            sender_history_response = await test_app.client.get(
                f"/dialogs/{dialog.id}/messages",
                headers=test_app.auth_headers(user1),
            )

            assert sender_history_response.status_code == 200
            assert sender_history_response.json()[0]["id"] == str(message.id)
            assert sender_history_response.json()[0]["status"] == "sent"

            user3_read_response = await test_app.client.post(
                f"/dialogs/{dialog.id}/read",
                headers=test_app.auth_headers(user3),
            )

            assert user3_read_response.status_code == 200

            read_sender_history_response = await test_app.client.get(
                f"/dialogs/{dialog.id}/messages",
                headers=test_app.auth_headers(user1),
            )

            assert read_sender_history_response.status_code == 200
            assert read_sender_history_response.json()[0]["status"] == "read"

    asyncio.run(run_test())


def test_read_dialogs_requires_token() -> None:
    async def run_test() -> None:
        async with DialogsTestClient() as test_app:
            response = await test_app.client.get("/dialogs")

            assert response.status_code == 401

    asyncio.run(run_test())
