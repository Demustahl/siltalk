from fastapi import FastAPI, status

from app.attachments import download_attachment, upload_attachment
from app.auth import (
    login_user,
    read_current_user,
    register_user,
    update_current_user_profile,
)
from app.dialogs import (
    create_group_dialog,
    mark_dialog_messages_read,
    read_dialog_messages,
    read_dialog_public_keys,
    read_dialogs,
)
from app.keys import publish_my_public_key, read_user_public_key
from app.realtime import websocket_chat
from app.schemas import (
    AttachmentRead,
    DialogRead,
    DialogReadMark,
    MessageRead,
    PublicKeyRead,
    TokenResponse,
    UserRead,
    UserSearchRead,
)
from app.users import search_users


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
        "/me/profile",
        update_current_user_profile,
        methods=["PUT"],
        response_model=UserRead,
        tags=["auth"],
    )
    app.add_api_route(
        "/me/keys",
        publish_my_public_key,
        methods=["PUT"],
        response_model=PublicKeyRead,
        tags=["keys"],
    )
    app.add_api_route(
        "/users/{username}/keys",
        read_user_public_key,
        methods=["GET"],
        response_model=PublicKeyRead,
        tags=["keys"],
    )
    app.add_api_route(
        "/users/search",
        search_users,
        methods=["GET"],
        response_model=list[UserSearchRead],
        tags=["users"],
    )
    app.add_api_route(
        "/attachments",
        upload_attachment,
        methods=["POST"],
        response_model=AttachmentRead,
        status_code=status.HTTP_201_CREATED,
        tags=["attachments"],
    )
    app.add_api_route(
        "/attachments/{attachment_id}",
        download_attachment,
        methods=["GET"],
        tags=["attachments"],
    )

    app.add_api_route(
        "/dialogs",
        read_dialogs,
        methods=["GET"],
        response_model=list[DialogRead],
        tags=["dialogs"],
    )
    app.add_api_route(
        "/dialogs/groups",
        create_group_dialog,
        methods=["POST"],
        response_model=DialogRead,
        status_code=status.HTTP_201_CREATED,
        tags=["dialogs"],
    )
    app.add_api_route(
        "/dialogs/{dialog_id}/keys",
        read_dialog_public_keys,
        methods=["GET"],
        response_model=list[PublicKeyRead],
        tags=["dialogs"],
    )
    app.add_api_route(
        "/dialogs/{dialog_id}/messages",
        read_dialog_messages,
        methods=["GET"],
        response_model=list[MessageRead],
        tags=["dialogs"],
    )
    app.add_api_route(
        "/dialogs/{dialog_id}/read",
        mark_dialog_messages_read,
        methods=["POST"],
        response_model=DialogReadMark,
        tags=["dialogs"],
    )

    app.add_api_websocket_route("/ws", websocket_chat)
