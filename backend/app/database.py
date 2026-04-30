from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATABASE_URL


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
)


# Выдает сессию БД и закрывает ее после работы
def get_db_session() -> Generator[Session]:
    db_session = SessionLocal()
    try:
        yield db_session
    finally:
        db_session.close()
