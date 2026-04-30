import os


DEFAULT_DATABASE_URL = "postgresql+psycopg://postgres:postgres@localhost:5432/siltalk"


# Берет адрес БД из окружения или использует локальный вариант
def get_database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


DATABASE_URL = get_database_url()
