import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user, normalize_username
from app.database import get_db_session
from app.messages import MESSAGE_STATUS_READ
from app.models import (
    DeviceKey,
    Dialog,
    DialogMember,
    Message,
    MessageDeliveryStatus,
    User,
    UserDevice,
)
from app.realtime import manager
from app.schemas import (
    DialogLastMessageRead,
    DialogRead,
    DialogReadMark,
    GroupDialogCreate,
    MessageRead,
    PublicKeyRead,
    UserPublicRead,
)
from app.users import has_public_key

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


def get_dialog_member_profiles(
    db_session: Session,
    dialog_id: uuid.UUID,
) -> list[UserPublicRead]:
    statement = (
        select(User)
        .join(DialogMember, DialogMember.user_id == User.id)
        .where(DialogMember.dialog_id == dialog_id)
        .order_by(User.username)
    )

    return [
        UserPublicRead(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            avatar_id=user.avatar_id,
            avatar_data_url=user.avatar_data_url,
        )
        for user in db_session.scalars(statement).all()
    ]


def get_last_dialog_message(
    db_session: Session,
    dialog_id: uuid.UUID,
) -> DialogLastMessageRead | None:
    statement = (
        select(Message, User.username)
        .join(User, User.id == Message.sender_user_id)
        .where(Message.dialog_id == dialog_id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    row = db_session.execute(statement).first()
    if row is None:
        return None

    message, sender_username = row
    return DialogLastMessageRead(
        id=message.id,
        sender_username=sender_username,
        ciphertext=message.ciphertext,
        created_at=message.created_at,
    )


# Собирает ответ диалога с участниками и счетчиком непрочитанных сообщений
def build_dialog_response(
    db_session: Session,
    dialog: Dialog,
    current_user: User,
) -> DialogRead:
    member_profiles = get_dialog_member_profiles(db_session, dialog.id)

    return DialogRead(
        id=dialog.id,
        dialog_type=dialog.dialog_type,
        title=dialog.title,
        members=[member.username for member in member_profiles],
        member_profiles=member_profiles,
        unread_count=count_unread_messages(
            db_session,
            dialog.id,
            current_user.id,
        ),
        last_message=get_last_dialog_message(db_session, dialog.id),
        created_at=dialog.created_at,
    )


def normalize_group_title(title: str) -> str:
    normalized_title = title.strip()
    if not normalized_title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Нужно название группы",
        )

    return normalized_title


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
def get_message_status(
    db_session: Session,
    message: Message,
    current_user_id: uuid.UUID,
) -> str:
    if message.sender_user_id != current_user_id:
        statement = select(MessageDeliveryStatus.status).where(
            MessageDeliveryStatus.message_id == message.id,
            MessageDeliveryStatus.user_id == current_user_id,
        )

        return db_session.scalar(statement) or "sent"

    statuses = list(
        db_session.scalars(
            select(MessageDeliveryStatus.status).where(
                MessageDeliveryStatus.message_id == message.id,
            )
        ).all()
    )
    if not statuses:
        return "sent"
    if all(message_status == "read" for message_status in statuses):
        return "read"
    if all(message_status in {"delivered", "read"} for message_status in statuses):
        return "delivered"

    return "sent"


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
    dialog_reads = [
        build_dialog_response(db_session, dialog, current_user)
        for dialog in dialogs
    ]

    return sorted(
        dialog_reads,
        key=lambda dialog: (
            dialog.last_message.created_at if dialog.last_message else dialog.created_at
        ),
        reverse=True,
    )


# Создает групповой диалог с пользователями, у которых есть публичные ключи
def create_group_dialog(
    group_data: GroupDialogCreate,
    current_user: CurrentUser,
    db_session: DbSession,
) -> DialogRead:
    member_usernames = {
        normalize_username(username)
        for username in group_data.member_usernames
        if normalize_username(username)
    }
    member_usernames.discard(current_user.username)
    if not member_usernames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Группе нужен хотя бы один другой участник",
        )

    users = list(
        db_session.scalars(
            select(User).where(User.username.in_(member_usernames))
        ).all()
    )
    found_usernames = {user.username for user in users}
    if found_usernames != member_usernames:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Некоторые участники группы не найдены",
        )

    all_members = [current_user, *users]
    members_without_keys = [
        user.username
        for user in all_members
        if not has_public_key(db_session, user.id)
    ]
    if members_without_keys:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "У всех участников группы должны быть публичные ключи",
                "usernames": members_without_keys,
            },
        )

    dialog = Dialog(
        dialog_type="group",
        title=normalize_group_title(group_data.title),
    )
    db_session.add(dialog)
    db_session.flush()

    db_session.add_all(
        [
            DialogMember(dialog_id=dialog.id, user_id=member.id)
            for member in all_members
        ]
    )
    db_session.commit()
    db_session.refresh(dialog)

    return build_dialog_response(db_session, dialog, current_user)


def read_dialog_public_keys(
    dialog_id: uuid.UUID,
    current_user: CurrentUser,
    db_session: DbSession,
) -> list[PublicKeyRead]:
    if not is_dialog_member(db_session, dialog_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Диалог не найден",
        )

    statement = (
        select(User, UserDevice, DeviceKey)
        .join(DialogMember, DialogMember.user_id == User.id)
        .join(UserDevice, UserDevice.user_id == User.id)
        .join(DeviceKey, DeviceKey.device_id == UserDevice.id)
        .where(
            DialogMember.dialog_id == dialog_id,
            DeviceKey.identity_key_public.is_not(None),
        )
        .order_by(User.username.asc(), DeviceKey.updated_at.desc())
    )
    rows = db_session.execute(statement).all()
    keys_by_username: dict[str, PublicKeyRead] = {}

    for user, device, device_key in rows:
        if user.username in keys_by_username:
            continue

        assert device_key.identity_key_public is not None
        keys_by_username[user.username] = PublicKeyRead(
            username=user.username,
            device_id=device.id,
            public_key=device_key.identity_key_public,
            updated_at=device_key.updated_at,
        )

    member_usernames = set(get_dialog_members(db_session, dialog_id))
    if set(keys_by_username) != member_usernames:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="У некоторых участников нет публичных ключей",
        )

    return list(keys_by_username.values())


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
            status=get_message_status(db_session, message, current_user.id),
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
        select(Message.id, User.id, User.username, MessageDeliveryStatus)
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
    sender_messages: defaultdict[
        tuple[str, uuid.UUID],
        list[uuid.UUID],
    ] = defaultdict(list)

    for message_id, sender_user_id, sender_username, delivery_status in rows:
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

        sender_messages[(sender_username, sender_user_id)].append(message_id)

    db_session.commit()

    for (sender_username, sender_user_id), message_ids in sender_messages.items():
        message_statuses: defaultdict[str, list[uuid.UUID]] = defaultdict(list)
        messages = db_session.scalars(
            select(Message).where(Message.id.in_(message_ids))
        ).all()

        for message in messages:
            message_statuses[
                get_message_status(db_session, message, sender_user_id)
            ].append(message.id)

        for message_status, status_message_ids in message_statuses.items():
            await manager.send_to_client(
                sender_username,
                {
                    "type": "messages_read",
                    "dialog_id": str(dialog_id),
                    "reader": current_user.username,
                    "status": message_status,
                    "message_ids": [
                        str(message_id) for message_id in status_message_ids
                    ],
                },
            )

    return DialogReadMark(dialog_id=dialog_id, marked_read_count=len(rows))
