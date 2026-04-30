import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db_session
from app.models import Dialog, DialogMember, Message, User
from app.schemas import DialogRead, MessageRead

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


# Возвращает usernames участников диалога
def get_dialog_members(db_session: Session, dialog_id: uuid.UUID) -> list[str]:
    statement = (
        select(User.username)
        .join(DialogMember, DialogMember.user_id == User.id)
        .where(DialogMember.dialog_id == dialog_id)
        .order_by(User.username)
    )

    return list(db_session.scalars(statement).all())


# Проверяет, что пользователь входит в диалог
def is_dialog_member(
    db_session: Session,
    dialog_id: uuid.UUID,
    user_id: uuid.UUID,
) -> bool:
    statement = select(DialogMember).where(
        DialogMember.dialog_id == dialog_id,
        DialogMember.user_id == user_id,
    )

    return db_session.scalar(statement) is not None


# Возвращает список диалогов текущего пользователя
def read_dialogs(
    current_user: CurrentUser,
    db_session: DbSession,
) -> list[DialogRead]:
    statement = (
        select(Dialog)
        .join(DialogMember, DialogMember.dialog_id == Dialog.id)
        .where(DialogMember.user_id == current_user.id)
        .order_by(Dialog.created_at.desc())
    )
    dialogs = db_session.scalars(statement).all()

    return [
        DialogRead(
            id=dialog.id,
            dialog_type=dialog.dialog_type,
            title=dialog.title,
            members=get_dialog_members(db_session, dialog.id),
            created_at=dialog.created_at,
        )
        for dialog in dialogs
    ]


# Возвращает историю сообщений из диалога
def read_dialog_messages(
    dialog_id: uuid.UUID,
    current_user: CurrentUser,
    db_session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[MessageRead]:
    if not is_dialog_member(db_session, dialog_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Диалог не найден",
        )

    statement = (
        select(Message, User.username)
        .join(User, User.id == Message.sender_user_id)
        .where(Message.dialog_id == dialog_id)
        .order_by(Message.created_at.asc())
        .limit(limit)
    )

    return [
        MessageRead(
            id=message.id,
            dialog_id=message.dialog_id,
            sender_user_id=message.sender_user_id,
            sender_username=sender_username,
            ciphertext=message.ciphertext,
            created_at=message.created_at,
        )
        for message, sender_username in db_session.execute(statement).all()
    ]
