from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db_session
from app.main import app
from app.models import Message
from app.realtime import manager


class MessengerFlowTestApp:
    def __init__(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_local = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )
        self.client = TestClient(app)

    def __enter__(self) -> "MessengerFlowTestApp":
        Base.metadata.create_all(bind=self.engine)
        app.dependency_overrides[get_db_session] = self.override_get_db_session
        manager.active_connections.clear()
        self.client.__enter__()
        return self

    def __exit__(self, *args: object) -> None:
        self.client.__exit__(*args)
        manager.active_connections.clear()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def override_get_db_session(self) -> Generator[Session]:
        db_session = self.session_local()
        try:
            yield db_session
        finally:
            db_session.close()

    def get_saved_messages(self) -> list[Message]:
        with self.session_local() as db_session:
            return list(db_session.scalars(select(Message)).all())


def register_user(client: TestClient, username: str) -> None:
    response = client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "secret-password",
            "display_name": username.title(),
        },
    )

    assert response.status_code == 201
    assert response.json()["username"] == username


def login_user(client: TestClient, username: str) -> str:
    response = client.post(
        "/auth/login",
        json={"username": username, "password": "secret-password"},
    )

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"

    access_token = response.json()["access_token"]
    assert isinstance(access_token, str)
    assert access_token

    return access_token


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def send_message_over_websocket(
    client: TestClient,
    sender_token: str,
    receiver_token: str,
    receiver_username: str,
    text: str,
) -> None:
    with (
        client.websocket_connect(f"/ws?token={sender_token}") as sender_socket,
        client.websocket_connect(f"/ws?token={receiver_token}") as receiver_socket,
    ):
        sender_socket.send_json(
            {"type": "message", "to": receiver_username, "text": text}
        )

        assert receiver_socket.receive_json() == {
            "type": "message",
            "from": "maksim",
            "text": text,
        }


def test_messenger_flow_register_login_send_and_read_history() -> None:
    with MessengerFlowTestApp() as test_app:
        client = test_app.client

        register_user(client, "maksim")
        register_user(client, "dima")
        register_user(client, "ivan")

        maksim_token = login_user(client, "maksim")
        dima_token = login_user(client, "dima")
        ivan_token = login_user(client, "ivan")

        me_response = client.get("/me", headers=auth_headers(maksim_token))

        assert me_response.status_code == 200
        assert me_response.json()["username"] == "maksim"

        send_message_over_websocket(
            client,
            maksim_token,
            dima_token,
            "dima",
            "encrypted-hello",
        )

        saved_messages = test_app.get_saved_messages()
        assert len(saved_messages) == 1
        assert saved_messages[0].ciphertext == "encrypted-hello"

        dialog_id = saved_messages[0].dialog_id

        dialogs_response = client.get("/dialogs", headers=auth_headers(maksim_token))

        assert dialogs_response.status_code == 200
        dialogs = dialogs_response.json()
        assert len(dialogs) == 1
        assert dialogs[0]["id"] == str(dialog_id)
        assert dialogs[0]["dialog_type"] == "direct"
        assert set(dialogs[0]["members"]) == {"maksim", "dima"}

        history_response = client.get(
            f"/dialogs/{dialog_id}/messages",
            headers=auth_headers(maksim_token),
        )

        assert history_response.status_code == 200
        history = history_response.json()
        assert len(history) == 1
        assert history[0]["dialog_id"] == str(dialog_id)
        assert history[0]["sender_username"] == "maksim"
        assert history[0]["ciphertext"] == "encrypted-hello"

        stranger_response = client.get(
            f"/dialogs/{dialog_id}/messages",
            headers=auth_headers(ivan_token),
        )

        assert stranger_response.status_code == 404
