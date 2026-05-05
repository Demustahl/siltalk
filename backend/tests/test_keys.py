import asyncio
import base64
from collections.abc import Generator

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db_session
from app.main import app
from app.models import DeviceKey


class KeysTestClient:
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
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        )

    async def __aenter__(self) -> "KeysTestClient":
        Base.metadata.create_all(bind=self.engine)
        app.dependency_overrides[get_db_session] = self.override_get_db_session
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.client.aclose()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def override_get_db_session(self) -> Generator[Session]:
        db_session = self.session_local()
        try:
            yield db_session
        finally:
            db_session.close()

    def get_device_keys(self) -> list[DeviceKey]:
        with self.session_local() as db_session:
            return list(db_session.scalars(select(DeviceKey)).all())


def make_public_key(byte_value: int) -> str:
    return base64.b64encode(bytes([byte_value]) * 32).decode("ascii")


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


async def register_and_login(client: httpx.AsyncClient, username: str) -> str:
    register_response = await client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "secret-password",
            "display_name": username.title(),
        },
    )
    assert register_response.status_code == 201

    login_response = await client.post(
        "/auth/login",
        json={"username": username, "password": "secret-password"},
    )
    assert login_response.status_code == 200

    return str(login_response.json()["access_token"])


def test_user_can_publish_and_other_user_can_read_public_key() -> None:
    async def run_test() -> None:
        async with KeysTestClient() as test_app:
            user1_token = await register_and_login(test_app.client, "user1")
            user2_token = await register_and_login(test_app.client, "user2")
            public_key = make_public_key(1)

            publish_response = await test_app.client.put(
                "/me/keys",
                headers=auth_headers(user1_token),
                json={"public_key": public_key, "device_name": "test browser"},
            )

            assert publish_response.status_code == 200
            assert publish_response.json()["username"] == "user1"
            assert publish_response.json()["public_key"] == public_key

            read_response = await test_app.client.get(
                "/users/user1/keys",
                headers=auth_headers(user2_token),
            )

            assert read_response.status_code == 200
            assert read_response.json()["public_key"] == public_key

            saved_keys = test_app.get_device_keys()
            assert len(saved_keys) == 1
            assert saved_keys[0].identity_key_public == public_key

    asyncio.run(run_test())


def test_publish_public_key_updates_existing_device_key() -> None:
    async def run_test() -> None:
        async with KeysTestClient() as test_app:
            token = await register_and_login(test_app.client, "user1")
            first_public_key = make_public_key(1)
            second_public_key = make_public_key(2)

            first_response = await test_app.client.put(
                "/me/keys",
                headers=auth_headers(token),
                json={"public_key": first_public_key},
            )
            second_response = await test_app.client.put(
                "/me/keys",
                headers=auth_headers(token),
                json={"public_key": second_public_key},
            )

            assert first_response.status_code == 200
            assert second_response.status_code == 200
            assert second_response.json()["public_key"] == second_public_key

            saved_keys = test_app.get_device_keys()
            assert len(saved_keys) == 1
            assert saved_keys[0].identity_key_public == second_public_key

    asyncio.run(run_test())


def test_read_public_key_returns_not_found_when_key_is_missing() -> None:
    async def run_test() -> None:
        async with KeysTestClient() as test_app:
            token = await register_and_login(test_app.client, "user1")

            response = await test_app.client.get(
                "/users/user1/keys",
                headers=auth_headers(token),
            )

            assert response.status_code == 404

    asyncio.run(run_test())


def test_publish_public_key_rejects_invalid_base64_key() -> None:
    async def run_test() -> None:
        async with KeysTestClient() as test_app:
            token = await register_and_login(test_app.client, "user1")

            response = await test_app.client.put(
                "/me/keys",
                headers=auth_headers(token),
                json={"public_key": "!" * 44},
            )

            assert response.status_code == 422

    asyncio.run(run_test())
