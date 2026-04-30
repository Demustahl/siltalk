import asyncio
from collections.abc import Generator

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password, verify_password
from app.database import Base, get_db_session
from app.main import app
from app.models import User


class AuthTestClient:
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

    async def __aenter__(self) -> httpx.AsyncClient:
        Base.metadata.create_all(bind=self.engine)
        app.dependency_overrides[get_db_session] = self.override_get_db_session
        return self.client

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

    # Ищет пользователя в тестовой БД
    def get_user(self, username: str) -> User | None:
        with self.session_local() as db_session:
            statement = select(User).where(User.username == username)
            return db_session.scalar(statement)


def test_password_hash_is_not_plain_password() -> None:
    password_hash = hash_password("secret-password")

    assert password_hash != "secret-password"
    assert verify_password("secret-password", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_register_creates_user_without_password_in_response() -> None:
    async def run_test() -> None:
        test_app = AuthTestClient()

        async with test_app as client:
            response = await client.post(
                "/auth/register",
                json={
                    "username": "UserOne",
                    "password": "secret-password",
                    "display_name": "User One",
                },
            )

            assert response.status_code == 201
            response_data = response.json()
            assert response_data["username"] == "userone"
            assert response_data["display_name"] == "User One"
            assert "password" not in response_data
            assert "password_hash" not in response_data

            user = test_app.get_user("userone")
            assert user is not None
            assert user.password_hash != "secret-password"

    asyncio.run(run_test())


def test_register_returns_conflict_for_duplicate_username() -> None:
    async def run_test() -> None:
        async with AuthTestClient() as client:
            user_data = {
                "username": "userone",
                "password": "secret-password",
                "display_name": "User One",
            }

            first_response = await client.post("/auth/register", json=user_data)
            second_response = await client.post("/auth/register", json=user_data)

            assert first_response.status_code == 201
            assert second_response.status_code == 409

    asyncio.run(run_test())


def test_login_returns_token_and_me_returns_current_user() -> None:
    async def run_test() -> None:
        async with AuthTestClient() as client:
            await client.post(
                "/auth/register",
                json={
                    "username": "userone",
                    "password": "secret-password",
                    "display_name": "User One",
                },
            )

            login_response = await client.post(
                "/auth/login",
                json={"username": "userone", "password": "secret-password"},
            )
            assert login_response.status_code == 200

            token_data = login_response.json()
            assert token_data["token_type"] == "bearer"
            assert token_data["access_token"]

            me_response = await client.get(
                "/me",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )

            assert me_response.status_code == 200
            assert me_response.json()["username"] == "userone"

    asyncio.run(run_test())


def test_login_returns_unauthorized_for_wrong_password() -> None:
    async def run_test() -> None:
        async with AuthTestClient() as client:
            await client.post(
                "/auth/register",
                json={"username": "userone", "password": "secret-password"},
            )

            response = await client.post(
                "/auth/login",
                json={"username": "userone", "password": "wrong-password"},
            )

            assert response.status_code == 401

    asyncio.run(run_test())
