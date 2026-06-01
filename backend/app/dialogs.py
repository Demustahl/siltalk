import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db_session
from app.messages import MESSAGE_STATUS_READ
from app.models import Dialog, DialogMember, Message, MessageDeliveryStatus, User
from app.realtime import manager
from app.schemas import DialogRead, DialogReadMark, MessageRead

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


# Возвращает текущий статус сообщения для истории диалога
def get_message_status(db_session: Session, message_id: uuid.UUID) -> str:
    statement = select(MessageDeliveryStatus.status).where(
        MessageDeliveryStatus.message_id == message_id,
    )

    return db_session.scalar(statement) or "sent"


# Считает входящие сообщения, которые текущий пользователь еще не прочитал
def count_unread_messages(
    db_session: Session,
    dialog_id: uuid.UUID,
    user_id: uuid.UUID,
) -> int:
    status_join = and_(
        MessageDeliveryStatus.message_id == Message.id,
        MessageDeliveryStatus.user_id == user_id,
    )
    statement = (
        select(func.count(Message.id))
        .outerjoin(MessageDeliveryStatus, status_join)
        .where(
            Message.dialog_id == dialog_id,
            Message.sender_user_id != user_id,
            or_(
                MessageDeliveryStatus.status.is_(None),
                MessageDeliveryStatus.status != MESSAGE_STATUS_READ,
            ),
        )
    )

    return db_session.scalar(statement) or 0


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
            unread_count=count_unread_messages(
                db_session,
                dialog.id,
                current_user.id,
            ),
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
            status=get_message_status(db_session, message.id),
            created_at=message.created_at,
        )
        for message, sender_username in db_session.execute(statement).all()
    ]


# Помечает входящие сообщения диалога прочитанными
async def mark_dialog_messages_read(
    dialog_id: uuid.UUID,
    current_user: CurrentUser,
    db_session: DbSession,
) -> DialogReadMark:
    if not is_dialog_member(db_session, dialog_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Диалог не найден",
        )

    status_join = and_(
        MessageDeliveryStatus.message_id == Message.id,
        MessageDeliveryStatus.user_id == current_user.id,
    )
    statement = (
        select(Message.id, User.username, MessageDeliveryStatus)
        .join(User, User.id == Message.sender_user_id)
        .outerjoin(MessageDeliveryStatus, status_join)
        .where(
            Message.dialog_id == dialog_id,
            Message.sender_user_id != current_user.id,
            or_(
                MessageDeliveryStatus.status.is_(None),
                MessageDeliveryStatus.status != MESSAGE_STATUS_READ,
            ),
        )
    )
    rows = db_session.execute(statement).all()
    sender_messages: defaultdict[str, list[uuid.UUID]] = defaultdict(list)

    for message_id, sender_username, delivery_status in rows:
        if delivery_status is None:
            db_session.add(
                MessageDeliveryStatus(
                    message_id=message_id,
                    user_id=current_user.id,
                    status=MESSAGE_STATUS_READ,
                )
            )
        else:
            delivery_status.status = MESSAGE_STATUS_READ

        sender_messages[sender_username].append(message_id)

    db_session.commit()

    for sender_username, message_ids in sender_messages.items():
        await manager.send_to_client(
            sender_username,
            {
                "type": "messages_read",
                "dialog_id": str(dialog_id),
                "reader": current_user.username,
                "status": MESSAGE_STATUS_READ,
                "message_ids": [str(message_id) for message_id in message_ids],
            },
        )

    return DialogReadMark(dialog_id=dialog_id, marked_read_count=len(rows))
