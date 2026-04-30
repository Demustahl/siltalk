import json
from typing import Any

from fastapi import Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.auth import get_user_from_token
from app.database import get_db_session
from app.messages import save_direct_message


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str, websocket: WebSocket) -> None:
        if self.active_connections.get(client_id) is websocket:
            del self.active_connections[client_id]

    async def send_to_client(self, client_id: str, message: dict[str, str]) -> bool:
        websocket = self.active_connections.get(client_id)
        if websocket is None:
            return False

        await websocket.send_json(message)
        return True

    async def send_to_all(self, message: dict[str, str]) -> None:
        for websocket in self.active_connections.values():
            await websocket.send_json(message)


manager = ConnectionManager()


# Обрабатывает WebSocket-подключение пользователя с access-токеном
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
                    {"type": "error", "text": "Некорректный JSON или формат сообщения"}
                )
                continue

            saved_message = save_direct_message(
                db_session,
                user,
                message["to"],
                message["text"],
            )
            if saved_message is None:
                await websocket.send_json(
                    {"type": "error", "text": "Получатель не найден"}
                )
                continue

            is_sent = await manager.send_to_client(
                message["to"],
                {
                    "type": "message",
                    "from": client_id,
                    "text": message["text"],
                },
            )
            if not is_sent:
                await websocket.send_json(
                    {"type": "error", "text": "Получатель не подключен"}
                )
    except WebSocketDisconnect:
        manager.disconnect(client_id, websocket)


# Проверяет входящее сообщение из WebSocket
def parse_message(raw_message: str) -> dict[str, str] | None:
    try:
        message: Any = json.loads(raw_message)
    except json.JSONDecodeError:
        return None

    if not isinstance(message, dict):
        return None

    message_type = message.get("type")
    to_client = message.get("to")
    text = message.get("text")

    if message_type != "message":
        return None
    if not isinstance(to_client, str) or not to_client:
        return None
    if not isinstance(text, str) or not text:
        return None

    return {"type": message_type, "to": to_client, "text": text}
