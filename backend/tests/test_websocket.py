import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

from app.main import app
from app.realtime import manager


class WebSocketSession:
    def __init__(self, url: str) -> None:
        parsed_url = urlsplit(url)
        self.path = parsed_url.path
        self.query_string = parsed_url.query.encode()
        self.to_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.from_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.task: asyncio.Task[None] | None = None

    async def __aenter__(self) -> "WebSocketSession":
        await self.connect()
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def connect(self) -> None:
        scope = {
            "type": "websocket",
            "asgi": {"version": "3.0"},
            "path": self.path,
            "raw_path": self.path.encode(),
            "root_path": "",
            "scheme": "ws",
            "query_string": self.query_string,
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
            "subprotocols": [],
        }

        self.task = asyncio.create_task(app(scope, self.to_app.get, self.from_app.put))
        await self.to_app.put({"type": "websocket.connect"})

        message = await asyncio.wait_for(self.from_app.get(), timeout=1)
        assert message["type"] == "websocket.accept"

    async def send_text(self, text: str) -> None:
        await self.to_app.put({"type": "websocket.receive", "text": text})

    async def send_json(self, data: dict[str, str]) -> None:
        await self.send_text(json.dumps(data))

    async def receive_json(self) -> dict[str, str]:
        message = await asyncio.wait_for(self.from_app.get(), timeout=1)
        assert message["type"] == "websocket.send"

        if "text" in message:
            return json.loads(message["text"])

        return json.loads(message["bytes"].decode())

    async def close(self) -> None:
        if self.task is None or self.task.done():
            return

        await self.to_app.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, timeout=1)


def setup_function() -> None:
    manager.active_connections.clear()


def test_websocket_connects_with_client_id() -> None:
    async def run_test() -> None:
        async with WebSocketSession("/ws?client_id=user1"):
            pass

    asyncio.run(run_test())


def test_websocket_sends_message_to_other_client() -> None:
    async def run_test() -> None:
        async with (
            WebSocketSession("/ws?client_id=user1") as user1,
            WebSocketSession("/ws?client_id=user2") as user2,
        ):
            await user1.send_json({"type": "message", "to": "user2", "text": "hello"})

            assert await user2.receive_json() == {
                "type": "message",
                "from": "user1",
                "text": "hello",
            }

    asyncio.run(run_test())


def test_websocket_returns_error_for_bad_json() -> None:
    async def run_test() -> None:
        async with WebSocketSession("/ws?client_id=user1") as websocket:
            await websocket.send_text("not json")

            assert await websocket.receive_json() == {
                "type": "error",
                "text": "Некорректный JSON или формат сообщения",
            }

    asyncio.run(run_test())


def test_websocket_returns_error_when_receiver_is_offline() -> None:
    async def run_test() -> None:
        async with WebSocketSession("/ws?client_id=user1") as websocket:
            await websocket.send_json(
                {"type": "message", "to": "user2", "text": "hello"}
            )

            assert await websocket.receive_json() == {
                "type": "error",
                "text": "Получатель не подключен",
            }

    asyncio.run(run_test())
