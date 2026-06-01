import base64
import binascii
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
)
from app.database import get_db_session
from app.models import User
from app.schemas import (
    TokenResponse,
    UserCreate,
    UserLogin,
    UserProfileUpdate,
    UserRead,
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

DbSession = Annotated[Session, Depends(get_db_session)]
BearerToken = Annotated[str, Depends(oauth2_scheme)]
AVATAR_ID_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}$")
AVATAR_DATA_URL_PREFIXES = (
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
)


# Делает username одинаковым для поиска и сохранения
def normalize_username(username: str) -> str:
    return username.strip().lower()


# Делает хэш пароля, чтобы не хранить пароль открытым текстом
def hash_password(password: str) -> str:
    iterations = 100_000
    salt = secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations,
    )

    return f"pbkdf2_sha256${iterations}${salt}${password_hash.hex()}"


# Проверяет пароль через сравнение хэшей
def verify_password(password: str, saved_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt, expected_hash = saved_hash.split("$")
        iterations = int(iterations_raw)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations,
    )

    return secrets.compare_digest(password_hash.hex(), expected_hash)


# Ищет пользователя по username
def get_user_by_username(db_session: Session, username: str) -> User | None:
    statement = select(User).where(User.username == normalize_username(username))
    return db_session.scalar(statement)


# Преобразует модель БД в безопасный ответ API
def build_user_response(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_id=user.avatar_id,
        avatar_data_url=user.avatar_data_url,
        created_at=user.created_at,
    )


def normalize_display_name(display_name: str | None) -> str | None:
    if display_name is None:
        return None

    normalized_display_name = display_name.strip()
    return normalized_display_name or None


def validate_avatar_id(avatar_id: str | None) -> str | None:
    if avatar_id is None:
        return None

    normalized_avatar_id = avatar_id.strip()
    if not normalized_avatar_id:
        return None
    if AVATAR_ID_PATTERN.fullmatch(normalized_avatar_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid avatar_id",
        )

    return normalized_avatar_id


def validate_avatar_data_url(avatar_data_url: str | None) -> str | None:
    if avatar_data_url is None:
        return None

    normalized_avatar_data_url = avatar_data_url.strip()
    if not normalized_avatar_data_url:
        return None
    if not normalized_avatar_data_url.startswith(AVATAR_DATA_URL_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Avatar must be PNG, JPEG or WebP",
        )

    _, encoded_image = normalized_avatar_data_url.split(",", maxsplit=1)
    try:
        base64.b64decode(encoded_image, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid avatar base64",
        ) from None

    return normalized_avatar_data_url


# Создает короткоживущий JWT-токен для пользователя
def create_access_token(user: User) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "exp": expires_at,
    }

    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


# Ищет пользователя по JWT-токену
def get_user_from_token(token: str, db_session: Session) -> User | None:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
        )
        user_id_raw = payload.get("sub")
        if not isinstance(user_id_raw, str):
            return None
        user_id = uuid.UUID(user_id_raw)
    except (jwt.PyJWTError, ValueError):
        return None

    return db_session.get(User, user_id)


# Достает текущего пользователя из JWT-токена
def get_current_user(token: BearerToken, db_session: DbSession) -> User:
    auth_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить токен",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = get_user_from_token(token, db_session)
    if user is None:
        raise auth_error

    return user


# Регистрирует нового пользователя
def register_user(user_data: UserCreate, db_session: DbSession) -> UserRead:
    username = normalize_username(user_data.username)
    existing_user = get_user_by_username(db_session, username)
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким username уже есть",
        )

    user = User(
        username=username,
        password_hash=hash_password(user_data.password),
        display_name=user_data.display_name,
    )
    db_session.add(user)

    try:
        db_session.commit()
    except IntegrityError:
        db_session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким username уже есть",
        ) from None

    db_session.refresh(user)
    return build_user_response(user)


def update_current_user_profile(
    profile_data: UserProfileUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db_session: DbSession,
) -> UserRead:
    changed_fields = profile_data.model_fields_set

    if "display_name" in changed_fields:
        current_user.display_name = normalize_display_name(profile_data.display_name)

    if "avatar_data_url" in changed_fields and profile_data.avatar_data_url:
        current_user.avatar_data_url = validate_avatar_data_url(
            profile_data.avatar_data_url
        )
        current_user.avatar_id = None
    elif "avatar_id" in changed_fields:
        current_user.avatar_id = validate_avatar_id(profile_data.avatar_id)
        current_user.avatar_data_url = None
    elif "avatar_data_url" in changed_fields:
        current_user.avatar_data_url = None

    db_session.commit()
    db_session.refresh(current_user)

    return build_user_response(current_user)


# Проверяет логин и пароль, потом выдает access-токен
def login_user(user_data: UserLogin, db_session: DbSession) -> TokenResponse:
    user = get_user_by_username(db_session, user_data.username)
    if user is None or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный username или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(access_token=create_access_token(user))


# Возвращает пользователя из текущего токена
def read_current_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    return build_user_response(current_user)
