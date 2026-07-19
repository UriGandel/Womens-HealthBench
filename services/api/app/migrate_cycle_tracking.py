"""Add optional cycle-tracking tables without rewriting existing data."""

from sqlalchemy import Engine, inspect

from app.database import Base, engine
from app.models import CycleDay, CycleSyncReceipt, CycleTrackingPreference

CYCLE_TABLES = (
    CycleTrackingPreference.__table__,
    CycleDay.__table__,
    CycleSyncReceipt.__table__,
)


def migrate(target_engine: Engine = engine) -> tuple[str, ...]:
    created: list[str] = []
    existing = set(Base.metadata.tables)
    inspector = inspect(target_engine)
    for table in CYCLE_TABLES:
        if table.name not in existing:
            raise RuntimeError(f"Cycle table metadata is missing: {table.name}")
        if inspector.has_table(table.name):
            continue
        table.create(target_engine)
        created.append(table.name)
    return tuple(created)


def main() -> None:
    created = migrate()
    if created:
        print(f"Created cycle-tracking tables: {', '.join(created)}")
    else:
        print("Cycle-tracking tables already exist; no changes made.")


if __name__ == "__main__":
    main()
