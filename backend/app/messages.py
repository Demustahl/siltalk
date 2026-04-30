import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import normalize_username
from app.models import Dialog, DialogMember, Message, User


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


# Сохраняет сообщение в прямом диалоге
def save_direct_message(
    db_session: Session,
    sender: User,
    receiver_username: str,
    ciphertext: str,
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
    db_session.commit()
    db_session.refresh(message)

    return message
