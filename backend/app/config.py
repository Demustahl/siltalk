import os
from pathlib import Path


DEFAULT_DATABASE_URL = "postgresql+psycopg://postgres:postgres@localhost:5432/siltalk"
DEFAULT_JWT_SECRET_KEY = "local-dev-secret-key-for-messenger-backend"
DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES = "60"
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


# Подгружает локальные настройки из backend/.env
def load_env_file() -> None:
    if not ENV_FILE.exists():
        return

    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ[key.strip()] = value.strip().strip("\"'")


load_env_file()


# Берет адрес БД из окружения или использует локальный вариант
def get_database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


# Берет ключ для подписи JWT-токенов
def get_jwt_secret_key() -> str:
    return os.getenv("JWT_SECRET_KEY", DEFAULT_JWT_SECRET_KEY)


# Берет время жизни access-токена в минутах
def get_access_token_expire_minutes() -> int:
    return int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES))


DATABASE_URL = get_database_url()
JWT_SECRET_KEY = get_jwt_secret_key()
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = get_access_token_expire_minutes()
