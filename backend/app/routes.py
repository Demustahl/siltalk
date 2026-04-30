from fastapi import FastAPI, status

from app.auth import login_user, read_current_user, register_user
from app.dialogs import read_dialog_messages, read_dialogs
from app.realtime import websocket_chat
from app.schemas import DialogRead, MessageRead, TokenResponse, UserRead


# Проверяет, что backend запущен
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


# Регистрирует все HTTP и WebSocket ручки проекта
def register_routes(app: FastAPI) -> None:
    app.add_api_route(
        "/health",
        healthcheck,
        methods=["GET"],
        tags=["system"],
    )

    app.add_api_route(
        "/auth/register",
        register_user,
        methods=["POST"],
        response_model=UserRead,
        status_code=status.HTTP_201_CREATED,
        tags=["auth"],
    )
    app.add_api_route(
        "/auth/login",
        login_user,
        methods=["POST"],
        response_model=TokenResponse,
        tags=["auth"],
    )
    app.add_api_route(
        "/me",
        read_current_user,
        methods=["GET"],
        response_model=UserRead,
        tags=["auth"],
    )

    app.add_api_route(
        "/dialogs",
        read_dialogs,
        methods=["GET"],
        response_model=list[DialogRead],
        tags=["dialogs"],
    )
    app.add_api_route(
        "/dialogs/{dialog_id}/messages",
        read_dialog_messages,
        methods=["GET"],
        response_model=list[MessageRead],
        tags=["dialogs"],
    )

    app.add_api_websocket_route("/ws", websocket_chat)
