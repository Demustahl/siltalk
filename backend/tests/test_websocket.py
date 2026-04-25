from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_websocket_echo() -> None:
    with client.websocket_connect("/ws") as websocket:
        websocket.send_text("hello")

        assert websocket.receive_text() == "hello"
