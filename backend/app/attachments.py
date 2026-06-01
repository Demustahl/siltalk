import uuid
from pathlib import Path
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import ATTACHMENT_STORAGE_PATH, MAX_ATTACHMENT_BYTES
from app.database import get_db_session
from app.models import DialogMember, Message, MessageAttachment, User
from app.schemas import AttachmentRead

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def get_attachment_path(storage_key: str) -> Path:
    return ATTACHMENT_STORAGE_PATH / storage_key


def build_attachment_response(attachment: MessageAttachment) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        encrypted_size=attachment.encrypted_size,
        created_at=attachment.created_at,
    )


def can_read_attachment(
    db_session: Session,
    attachment: MessageAttachment,
    user_id: uuid.UUID,
) -> bool:
    if attachment.uploader_user_id == user_id:
        return True
    if attachment.message_id is None:
        return False

    statement = (
        select(DialogMember)
        .join(Message, Message.dialog_id == DialogMember.dialog_id)
        .where(
            Message.id == attachment.message_id,
            DialogMember.user_id == user_id,
        )
    )

    return db_session.scalar(statement) is not None


async def upload_attachment(
    request: Request,
    current_user: CurrentUser,
    db_session: DbSession,
) -> AttachmentRead:
    encrypted_content = await request.body()
    if not encrypted_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attachment is empty",
        )
    if len(encrypted_content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Attachment is too large",
        )

    attachment_id = uuid.uuid4()
    storage_key = f"{attachment_id}.bin"
    ATTACHMENT_STORAGE_PATH.mkdir(parents=True, exist_ok=True)
    attachment_path = get_attachment_path(storage_key)
    attachment_path.write_bytes(encrypted_content)

    attachment = MessageAttachment(
        id=attachment_id,
        uploader_user_id=current_user.id,
        storage_key=storage_key,
        encrypted_size=len(encrypted_content),
    )
    db_session.add(attachment)

    try:
        db_session.commit()
    except SQLAlchemyError:
        db_session.rollback()
        attachment_path.unlink(missing_ok=True)
        raise

    db_session.refresh(attachment)

    return build_attachment_response(attachment)


def download_attachment(
    attachment_id: uuid.UUID,
    current_user: CurrentUser,
    db_session: DbSession,
) -> FileResponse:
    attachment = db_session.get(MessageAttachment, attachment_id)
    if attachment is None or not can_read_attachment(
        db_session,
        attachment,
        current_user.id,
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found",
        )

    attachment_path = get_attachment_path(attachment.storage_key)
    if not attachment_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment file not found",
        )

    return FileResponse(
        path=attachment_path,
        media_type="application/octet-stream",
        filename=f"{attachment.id}.bin",
    )
