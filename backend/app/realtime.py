import json
import uuid
from typing import Any

from fastapi import Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.auth import get_user_from_token, normalize_username
from app.database import get_db_session
from app.messages import (
    MESSAGE_STATUS_DELIVERED,
    MESSAGE_STATUS_SENT,
    get_dialog_recipient_users,
    mark_message_delivered,
    save_dialog_message,
    save_direct_message,
    update_message_delivery_status,
)
from app.models import User


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str, websocket: WebSocket) -> None:
        if self.active_connections.get(client_id) is websocket:
            del self.active_connections[client_id]

    async def send_to_client(self, client_id: str, message: dict[str, Any]) -> bool:
        websocket = self.active_connections.get(client_id)
        if websocket is None:
            return False

        try:
            await websocket.send_json(message)
        except (RuntimeError, WebSocketDisconnect):
            if self.active_connections.get(client_id) is websocket:
                del self.active_connections[client_id]
            return False

        return True

    async def send_to_all(self, message: dict[str, Any]) -> None:
        for websocket in self.active_connections.values():
            await websocket.send_json(message)


manager = ConnectionManager()


async def websocket_chat(
    websocket: WebSocket,
    db_session: Session = Depends(get_db_session),
    token: str | None = None,
) -> None:
    if token is None:
        await websocket.accept()
        await websocket.send_json(
            {"type": "error", "text": "Нужно передать token в query params"}
        )
        await websocket.close()
        return

    user = get_user_from_token(token, db_session)
    if user is None:
        await websocket.accept()
        await websocket.send_json({"type": "error", "text": "Некорректный token"})
        await websocket.close()
        return

    client_id = user.username
    await manager.connect(client_id, websocket)

    try:
        while True:
            raw_message = await websocket.receive_text()
            message = parse_message(raw_message)

            if message is None:
                await websocket.send_json(
                    {
                        "type": "error",
                        "text": "Некорректный JSON или формат сообщения",
                    }
                )
                continue

            if message["dialog_id"] is not None:
                await handle_dialog_message(db_session, user, websocket, message)
            else:
                await handle_direct_message(db_session, user, websocket, message)
    except WebSocketDisconnect:
        manager.disconnect(client_id, websocket)


async def handle_direct_message(
    db_session: Session,
    user: User,
    websocket: WebSocket,
    message: dict[str, Any],
) -> None:
    receiver_username = normalize_username(message["to"])
    saved_message = save_direct_message(
        db_session,
        user,
        receiver_username,
        message["ciphertext"],
        message["attachment_ids"],
    )
    if saved_message is None:
        error_text = (
            "Получатель не найден"
            if not message["attachment_ids"]
            else "Получатель не найден или вложение недоступно"
        )
        await websocket.send_json({"type": "error", "text": error_text})
        return

    attachment_id_strings = [
        str(attachment_id) for attachment_id in message["attachment_ids"]
    ]
    is_delivered = await manager.send_to_client(
        receiver_username,
        {
            "type": "message",
            "id": str(saved_message.id),
            "dialog_id": str(saved_message.dialog_id),
            "from": user.username,
            "sender_user_id": str(user.id),
            "ciphertext": message["ciphertext"],
            "attachment_ids": attachment_id_strings,
            "status": MESSAGE_STATUS_DELIVERED,
            "created_at": saved_message.created_at.isoformat(),
        },
    )

    message_status = MESSAGE_STATUS_SENT
    if is_delivered:
        mark_message_delivered(
            db_session,
            saved_message.id,
            receiver_username,
        )
        message_status = MESSAGE_STATUS_DELIVERED

    await websocket.send_json(
        {
            "type": "message_status",
            "message_id": str(saved_message.id),
            "dialog_id": str(saved_message.dialog_id),
            "to": receiver_username,
            "status": message_status,
            "saved": True,
            "delivered": is_delivered,
            "recipient_online": is_delivered,
            "delivered_count": 1 if is_delivered else 0,
            "recipient_count": 1,
            "attachment_ids": attachment_id_strings,
            "created_at": saved_message.created_at.isoformat(),
        }
    )


async def handle_dialog_message(
    db_session: Session,
    user: User,
    websocket: WebSocket,
    message: dict[str, Any],
) -> None:
    dialog_id = message["dialog_id"]
    recipient_users = get_dialog_recipient_users(db_session, dialog_id, user.id)
    saved_message = save_dialog_message(
        db_session,
        user,
        dialog_id,
        message["ciphertext"],
        message["attachment_ids"],
    )
    if saved_message is None:
        await websocket.send_json(
            {"type": "error", "text": "Диалог не найден или вложение недоступно"}
        )
        return

    attachment_id_strings = [
        str(attachment_id) for attachment_id in message["attachment_ids"]
    ]
    delivered_count = 0
    for recipient in recipient_users:
        is_delivered = await manager.send_to_client(
            recipient.username,
            {
                "type": "message",
                "id": str(saved_message.id),
                "dialog_id": str(saved_message.dialog_id),
                "from": user.username,
                "sender_user_id": str(user.id),
                "ciphertext": message["ciphertext"],
                "attachment_ids": attachment_id_strings,
                "status": MESSAGE_STATUS_DELIVERED,
                "created_at": saved_message.created_at.isoformat(),
            },
        )
        if is_delivered:
            update_message_delivery_status(
                db_session,
                saved_message.id,
                recipient.id,
                MESSAGE_STATUS_DELIVERED,
            )
            delivered_count += 1

    recipient_count = len(recipient_users)
    message_status = (
        MESSAGE_STATUS_DELIVERED
        if recipient_count > 0 and delivered_count == recipient_count
        else MESSAGE_STATUS_SENT
    )
    await websocket.send_json(
        {
            "type": "message_status",
            "message_id": str(saved_message.id),
            "dialog_id": str(saved_message.dialog_id),
            "status": message_status,
            "saved": True,
            "delivered": delivered_count > 0,
            "recipient_online": delivered_count > 0,
            "delivered_count": delivered_count,
            "recipient_count": recipient_count,
            "attachment_ids": attachment_id_strings,
            "created_at": saved_message.created_at.isoformat(),
        }
    )


def parse_message(raw_message: str) -> dict[str, Any] | None:
    try:
        message: Any = json.loads(raw_message)
    except json.JSONDecodeError:
        return None

    if not isinstance(message, dict):
        return None

    message_type = message.get("type")
    to_client = message.get("to")
    dialog_id_raw = message.get("dialog_id")
    ciphertext = message.get("ciphertext")
    attachment_ids_raw = message.get("attachment_ids", [])

    if message_type != "message":
        return None
    if not isinstance(ciphertext, str) or not ciphertext:
        return None
    if not isinstance(attachment_ids_raw, list) or len(attachment_ids_raw) > 5:
        return None

    dialog_id = None
    if dialog_id_raw is not None:
        if not isinstance(dialog_id_raw, str):
            return None
        try:
            dialog_id = uuid.UUID(dialog_id_raw)
        except ValueError:
            return None
    elif not isinstance(to_client, str) or not to_client:
        return None

    attachment_ids: list[uuid.UUID] = []
    for attachment_id_raw in attachment_ids_raw:
        if not isinstance(attachment_id_raw, str):
            return None
        try:
            attachment_ids.append(uuid.UUID(attachment_id_raw))
        except ValueError:
            return None

    return {
        "type": message_type,
        "to": to_client,
        "dialog_id": dialog_id,
        "ciphertext": ciphertext,
        "attachment_ids": attachment_ids,
    }
