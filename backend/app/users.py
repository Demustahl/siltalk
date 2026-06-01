import uuid
from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user, normalize_username
from app.database import get_db_session
from app.models import DeviceKey, User, UserDevice
from app.schemas import UserSearchRead

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


# Проверяет, есть ли у пользователя опубликованный публичный ключ
def has_public_key(db_session: Session, user_id: uuid.UUID) -> bool:
    statement = (
        select(DeviceKey.id)
        .join(UserDevice, UserDevice.id == DeviceKey.device_id)
        .where(
            UserDevice.user_id == user_id,
            DeviceKey.identity_key_public.is_not(None),
        )
        .limit(1)
    )

    return db_session.scalar(statement) is not None


# Ищет пользователей по началу username
def search_users(
    current_user: CurrentUser,
    db_session: DbSession,
    username: Annotated[str, Query(min_length=1, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> list[UserSearchRead]:
    username_part = normalize_username(username)
    statement = (
        select(User)
        .where(
            User.username.like(f"{username_part}%"),
            User.id != current_user.id,
        )
        .order_by(User.username.asc())
        .limit(limit)
    )
    users = db_session.scalars(statement).all()

    return [
        UserSearchRead(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            avatar_id=user.avatar_id,
            avatar_data_url=user.avatar_data_url,
            has_public_key=True,
        )
        for user in users
        if has_public_key(db_session, user.id)
    ]
