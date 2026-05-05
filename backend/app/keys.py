import base64
import binascii
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_user_by_username
from app.database import get_db_session
from app.models import DeviceKey, User, UserDevice
from app.schemas import PublicKeyPublish, PublicKeyRead

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def validate_public_key(public_key: str) -> None:
    try:
        public_key_bytes = base64.b64decode(public_key, validate=True)
    except binascii.Error:
        raise HTTPException(
            status_code=422,
            detail="Публичный ключ должен быть в base64",
        ) from None

    if len(public_key_bytes) != 32:
        raise HTTPException(
            status_code=422,
            detail="Публичный ключ libsodium должен быть 32 байта",
        )


def build_public_key_response(
    user: User,
    device: UserDevice,
    device_key: DeviceKey,
) -> PublicKeyRead:
    assert device_key.identity_key_public is not None

    return PublicKeyRead(
        username=user.username,
        device_id=device.id,
        public_key=device_key.identity_key_public,
        updated_at=device_key.updated_at,
    )


def get_first_user_device(db_session: Session, user: User) -> UserDevice | None:
    statement = (
        select(UserDevice)
        .where(UserDevice.user_id == user.id)
        .order_by(UserDevice.created_at.asc())
    )

    return db_session.scalar(statement)


def get_device_key(db_session: Session, device: UserDevice) -> DeviceKey | None:
    statement = select(DeviceKey).where(DeviceKey.device_id == device.id)

    return db_session.scalar(statement)


def publish_my_public_key(
    key_data: PublicKeyPublish,
    current_user: CurrentUser,
    db_session: DbSession,
) -> PublicKeyRead:
    validate_public_key(key_data.public_key)

    device = get_first_user_device(db_session, current_user)
    if device is None:
        device = UserDevice(
            user_id=current_user.id,
            name=key_data.device_name or "browser",
        )
        db_session.add(device)
        db_session.flush()

    device_key = get_device_key(db_session, device)
    if device_key is None:
        device_key = DeviceKey(device_id=device.id)
        db_session.add(device_key)

    device_key.identity_key_public = key_data.public_key
    db_session.commit()
    db_session.refresh(device)
    db_session.refresh(device_key)

    return build_public_key_response(current_user, device, device_key)


def read_user_public_key(
    username: str,
    _current_user: CurrentUser,
    db_session: DbSession,
) -> PublicKeyRead:
    user = get_user_by_username(db_session, username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Публичный ключ пользователя не найден",
        )

    statement = (
        select(UserDevice, DeviceKey)
        .join(DeviceKey, DeviceKey.device_id == UserDevice.id)
        .where(
            UserDevice.user_id == user.id,
            DeviceKey.identity_key_public.is_not(None),
        )
        .order_by(DeviceKey.updated_at.desc())
    )
    row = db_session.execute(statement).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Публичный ключ пользователя не найден",
        )

    device, device_key = row
    return build_public_key_response(user, device, device_key)
