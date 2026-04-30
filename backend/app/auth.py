import hashlib
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
from app.schemas import TokenResponse, UserCreate, UserLogin, UserRead

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

DbSession = Annotated[Session, Depends(get_db_session)]
BearerToken = Annotated[str, Depends(oauth2_scheme)]


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
        created_at=user.created_at,
    )


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
