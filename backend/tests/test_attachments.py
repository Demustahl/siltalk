import asyncio
import shutil
import tempfile
import uuid
from collections.abc import Generator
from pathlib import Path

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import attachments as attachments_module
from app.auth import create_access_token, hash_password
from app.database import Base, get_db_session
from app.main import app
from app.messages import save_direct_message
from app.models import MessageAttachment, User


class AttachmentsTestClient:
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
        self.storage_path = Path(tempfile.mkdtemp(prefix="siltalk-attachments-"))
        self.original_storage_path = attachments_module.ATTACHMENT_STORAGE_PATH

    async def __aenter__(self) -> "AttachmentsTestClient":
        Base.metadata.create_all(bind=self.engine)
        app.dependency_overrides[get_db_session] = self.override_get_db_session
        attachments_module.ATTACHMENT_STORAGE_PATH = self.storage_path
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.client.aclose()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        attachments_module.ATTACHMENT_STORAGE_PATH = self.original_storage_path
        shutil.rmtree(self.storage_path, ignore_errors=True)

    def override_get_db_session(self) -> Generator[Session]:
        db_session = self.session_local()
        try:
            yield db_session
        finally:
            db_session.close()

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

    def auth_headers(self, user: User) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user)}"}

    def get_attachment(self) -> MessageAttachment | None:
        with self.session_local() as db_session:
            return db_session.scalar(select(MessageAttachment))


def test_upload_and_download_encrypted_attachment() -> None:
    async def run_test() -> None:
        async with AttachmentsTestClient() as test_app:
            user = test_app.create_user("user1")
            encrypted_content = b"encrypted-file-bytes"

            upload_response = await test_app.client.post(
                "/attachments",
                headers={
                    **test_app.auth_headers(user),
                    "Content-Type": "application/octet-stream",
                },
                content=encrypted_content,
            )

            assert upload_response.status_code == 201
            response_data = upload_response.json()
            assert response_data["encrypted_size"] == len(encrypted_content)
            assert "filename" not in response_data
            assert "mime_type" not in response_data

            attachment = test_app.get_attachment()
            assert attachment is not None
            assert attachment.encrypted_size == len(encrypted_content)

            download_response = await test_app.client.get(
                f"/attachments/{response_data['id']}",
                headers=test_app.auth_headers(user),
            )

            assert download_response.status_code == 200
            assert download_response.content == encrypted_content

    asyncio.run(run_test())


def test_unlinked_attachment_is_private_to_uploader() -> None:
    async def run_test() -> None:
        async with AttachmentsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")

            upload_response = await test_app.client.post(
                "/attachments",
                headers={
                    **test_app.auth_headers(user1),
                    "Content-Type": "application/octet-stream",
                },
                content=b"encrypted-file-bytes",
            )

            assert upload_response.status_code == 201

            download_response = await test_app.client.get(
                f"/attachments/{upload_response.json()['id']}",
                headers=test_app.auth_headers(user2),
            )

            assert download_response.status_code == 404

    asyncio.run(run_test())


def test_dialog_member_can_download_linked_attachment() -> None:
    async def run_test() -> None:
        async with AttachmentsTestClient() as test_app:
            user1 = test_app.create_user("user1")
            user2 = test_app.create_user("user2")

            upload_response = await test_app.client.post(
                "/attachments",
                headers={
                    **test_app.auth_headers(user1),
                    "Content-Type": "application/octet-stream",
                },
                content=b"encrypted-file-bytes",
            )
            attachment_id = uuid.UUID(upload_response.json()["id"])

            with test_app.session_local() as db_session:
                attached_user = db_session.get(User, user1.id)
                assert attached_user is not None
                message = save_direct_message(
                    db_session,
                    attached_user,
                    user2.username,
                    "ciphertext-with-attachment",
                    [attachment_id],
                )

            assert message is not None

            download_response = await test_app.client.get(
                f"/attachments/{attachment_id}",
                headers=test_app.auth_headers(user2),
            )

            assert download_response.status_code == 200
            assert download_response.content == b"encrypted-file-bytes"

    asyncio.run(run_test())
