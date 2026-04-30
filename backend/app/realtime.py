import json
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


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


@router.websocket("/ws")
async def websocket_chat(websocket: WebSocket, client_id: str | None = None) -> None:
    if client_id is None:
        await websocket.accept()
        await websocket.send_json(
            {"type": "error", "text": "Нужно передать client_id в query params"}
        )
        await websocket.close()
        return

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
