from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

import app.models  # noqa: F401
from app.database import Base


EXPECTED_TABLES = {
    "users",
    "user_devices",
    "device_keys",
    "dialogs",
    "dialog_members",
    "messages",
    "message_delivery_statuses",
    "refresh_tokens",
}


def test_metadata_contains_messenger_tables() -> None:
    assert EXPECTED_TABLES.issubset(Base.metadata.tables)


def test_messages_store_ciphertext_without_plaintext() -> None:
    columns = set(Base.metadata.tables["messages"].columns.keys())

    assert "ciphertext" in columns
    assert "plaintext" not in columns
    assert "text" not in columns


def test_users_store_password_hash_without_plain_password() -> None:
    columns = set(Base.metadata.tables["users"].columns.keys())

    assert "password_hash" in columns
    assert "password" not in columns


def test_metadata_compiles_for_postgresql_without_connection() -> None:
    dialect = postgresql.dialect()

    for table in Base.metadata.sorted_tables:
        create_table_sql = str(CreateTable(table).compile(dialect=dialect))

        assert f"CREATE TABLE {table.name}" in create_table_sql
