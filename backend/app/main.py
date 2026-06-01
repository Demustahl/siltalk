import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import engine, get_db_session
from app.routes import register_routes

logger = logging.getLogger("uvicorn.error")


# Проверяет БД при запуске сервера и пишет результат в логи
def log_database_connection(app: FastAPI) -> None:
    if get_db_session in app.dependency_overrides:
        return

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.error("БД: подключение не удалось: %s", error)
        return

    logger.info("БД: подключение успешно")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log_database_connection(app)
    yield


app = FastAPI(title="Messenger API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Возвращает понятную ошибку, если backend не может работать с БД
@app.exception_handler(SQLAlchemyError)
async def database_error_handler(
    _request: Request,
    _exc: SQLAlchemyError,
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "База данных недоступна или миграции не применены"},
    )


register_routes(app)
