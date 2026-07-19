"""Add wearable schema objects without rewriting existing data."""

from sqlalchemy import Engine, inspect, text
from sqlalchemy.schema import CreateColumn

from app.database import Base, engine
from app.models import (
    ResearchWearableDay,
    ResearchWearableInterval,
    WearableConnection,
    WearableDailySummary,
    WearableIntervalSummary,
    WearableIntervalSyncReceipt,
    WearableSyncReceipt,
)

WEARABLE_TABLES = (
    WearableConnection.__table__,
    WearableDailySummary.__table__,
    WearableSyncReceipt.__table__,
    ResearchWearableDay.__table__,
    WearableIntervalSummary.__table__,
    WearableIntervalSyncReceipt.__table__,
    ResearchWearableInterval.__table__,
)

ADDITIVE_COLUMNS = (
    WearableDailySummary.__table__.c.peripheral_temperature_delta_c,
    ResearchWearableDay.__table__.c.peripheral_temperature_delta_c,
)


def migrate(target_engine: Engine = engine) -> tuple[str, ...]:
    created: list[str] = []
    existing = set(Base.metadata.tables)
    inspector = inspect(target_engine)
    for table in WEARABLE_TABLES:
        if table.name not in existing:
            raise RuntimeError(f"Wearable table metadata is missing: {table.name}")
        if not inspector.has_table(table.name):
            table.create(target_engine)
            created.append(table.name)

    inspector = inspect(target_engine)
    preparer = target_engine.dialect.identifier_preparer
    for column in ADDITIVE_COLUMNS:
        table = column.table
        if column.name in {
            existing_column["name"] for existing_column in inspector.get_columns(table.name)
        }:
            continue
        column_ddl = str(CreateColumn(column).compile(dialect=target_engine.dialect))
        table_name = preparer.quote(table.name)
        with target_engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_ddl}"))
        created.append(f"{table.name}.{column.name}")
    return tuple(created)


def main() -> None:
    created = migrate()
    if created:
        print(f"Created wearable schema objects: {', '.join(created)}")
    else:
        print("Wearable tables already exist; no changes made.")


if __name__ == "__main__":
    main()
