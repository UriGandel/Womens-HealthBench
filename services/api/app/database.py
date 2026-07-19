from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def build_engine(database_url: str) -> Engine:
    # Hosting providers (Render, Heroku, …) hand out plain postgresql:// URLs,
    # which SQLAlchemy routes to the psycopg2 driver. This project installs
    # psycopg 3, so pin the scheme to +psycopg here rather than requiring every
    # environment to hand-edit its DATABASE_URL. Do not remove.
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)

    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)

    if database_url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine = build_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


def create_tables(target_engine: Engine = engine) -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(target_engine)

