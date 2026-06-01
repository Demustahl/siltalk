import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import normalize_username
from app.models import (
    Dialog,
    DialogMember,
    Message,
    MessageAttachment,
    MessageDeliveryStatus,
    User,
)

MESSAGE_STATUS_SENT = "sent"
MESSAGE_STATUS_DELIVERED = "delivered"
MESSAGE_STATUS_READ = "read"
MESSAGE_STATUS_ORDER = {
    MESSAGE_STATUS_SENT: 1,
    MESSAGE_STATUS_DELIVERED: 2,
    MESSAGE_STATUS_READ: 3,
}
MAX_MESSAGE_ATTACHMENTS = 5


# Ищет прямой диалог двух пользователей
def find_direct_dialog(
    db_session: Session,
    first_user_id: uuid.UUID,
    second_user_id: uuid.UUID,
) -> Dialog | None:
    user_ids = [first_user_id, second_user_id]
    statement = (
        select(DialogMember.dialog_id)
        .join(Dialog, Dialog.id == DialogMember.dialog_id)
        .where(
            Dialog.dialog_type == "direct",
            DialogMember.user_id.in_(user_ids),
        )
        .group_by(DialogMember.dialog_id)
        .having(func.count(DialogMember.user_id) == 2)
    )
    dialog_id = db_session.scalar(statement)
    if dialog_id is None:
        return None

    return db_session.get(Dialog, dialog_id)


# Создает прямой диалог, если его еще нет
def get_or_create_direct_dialog(
    db_session: Session,
    first_user: User,
    second_user: User,
) -> Dialog:
    existing_dialog = find_direct_dialog(db_session, first_user.id, second_user.id)
    if existing_dialog is not None:
        return existing_dialog

    dialog = Dialog(dialog_type="direct")
    db_session.add(dialog)
    db_session.flush()

    db_session.add_all(
        [
            DialogMember(dialog_id=dialog.id, user_id=first_user.id),
            DialogMember(dialog_id=dialog.id, user_id=second_user.id),
        ]
    )
    db_session.flush()

    return dialog


# Обновляет статус сообщения для конкретного получателя
def update_message_delivery_status(
    db_session: Session,
    message_id: uuid.UUID,
    user_id: uuid.UUID,
    new_status: str,
) -> MessageDeliveryStatus | None:
    delivery_status = db_session.get(MessageDeliveryStatus, (message_id, user_id))
    if delivery_status is None:
        return None

    old_order = MESSAGE_STATUS_ORDER.get(delivery_status.status, 0)
    new_order = MESSAGE_STATUS_ORDER[new_status]
    if old_order >= new_order:
        return delivery_status

    delivery_status.status = new_status
    db_session.commit()
    db_session.refresh(delivery_status)

    return delivery_status


# Отмечает сообщение доставленным получателю
def mark_message_delivered(
    db_session: Session,
    message_id: uuid.UUID,
    receiver_username: str,
) -> MessageDeliveryStatus | None:
    receiver = db_session.scalar(
        select(User).where(User.username == normalize_username(receiver_username))
    )
    if receiver is None:
        return None

    return update_message_delivery_status(
        db_session,
        message_id,
        receiver.id,
        MESSAGE_STATUS_DELIVERED,
    )


# Сохраняет сообщение в прямом диалоге
def link_message_attachments(
    db_session: Session,
    message: Message,
    sender: User,
    attachment_ids: list[uuid.UUID],
) -> bool:
    unique_attachment_ids = list(dict.fromkeys(attachment_ids))
    if len(unique_attachment_ids) > MAX_MESSAGE_ATTACHMENTS:
        return False
    if not unique_attachment_ids:
        return True

    attachments = list(
        db_session.scalars(
            select(MessageAttachment).where(
                MessageAttachment.id.in_(unique_attachment_ids)
            )
        ).all()
    )
    if len(attachments) != len(unique_attachment_ids):
        return False

    for attachment in attachments:
        if attachment.uploader_user_id != sender.id:
            return False
        if attachment.message_id is not None:
            return False

    for attachment in attachments:
        attachment.message_id = message.id

    return True


def save_direct_message(
    db_session: Session,
    sender: User,
    receiver_username: str,
    ciphertext: str,
    attachment_ids: list[uuid.UUID] | None = None,
) -> Message | None:
    username = normalize_username(receiver_username)
    receiver = db_session.scalar(select(User).where(User.username == username))
    if receiver is None:
        return None
    if receiver.id == sender.id:
        return None

    dialog = get_or_create_direct_dialog(db_session, sender, receiver)
    message = Message(
        dialog_id=dialog.id,
        sender_user_id=sender.id,
        ciphertext=ciphertext,
    )
    db_session.add(message)
    db_session.flush()

    if not link_message_attachments(db_session, message, sender, attachment_ids or []):
        db_session.rollback()
        return None

    db_session.add(
        MessageDeliveryStatus(
            message_id=message.id,
            user_id=receiver.id,
            status=MESSAGE_STATUS_SENT,
        )
    )
    db_session.commit()
    db_session.refresh(message)

    return message
