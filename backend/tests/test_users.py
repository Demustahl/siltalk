import asyncio
import base64
from collections.abc import Generator

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db_session
from app.main import app


class UsersTestClient:
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

    async def __aenter__(self) -> "UsersTestClient":
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


def test_search_users_by_username_returns_safe_public_data() -> None:
    async def run_test() -> None:
        async with UsersTestClient() as test_app:
            alice_token = await register_and_login(test_app.client, "alice")
            bob_token = await register_and_login(test_app.client, "bob")
            await register_and_login(test_app.client, "bobby")
            await register_and_login(test_app.client, "carol")

            publish_response = await test_app.client.put(
                "/me/keys",
                headers=auth_headers(bob_token),
                json={"public_key": make_public_key(1)},
            )
            assert publish_response.status_code == 200
            profile_response = await test_app.client.put(
                "/me/profile",
                headers=auth_headers(bob_token),
                json={"avatar_id": "ava-robot"},
            )
            assert profile_response.status_code == 200

            response = await test_app.client.get(
                "/users/search?username=bo",
                headers=auth_headers(alice_token),
            )

            assert response.status_code == 200
            response_data = response.json()
            assert [user["username"] for user in response_data] == ["bob"]
            assert response_data[0]["has_public_key"] is True
            assert response_data[0]["avatar_id"] == "ava-robot"
            assert response_data[0]["avatar_data_url"] is None
            assert "password" not in response_data[0]
            assert "password_hash" not in response_data[0]
            assert "private_key" not in response_data[0]

    asyncio.run(run_test())


def test_search_users_requires_token() -> None:
    async def run_test() -> None:
        async with UsersTestClient() as test_app:
            response = await test_app.client.get("/users/search?username=user")

            assert response.status_code == 401

    asyncio.run(run_test())
