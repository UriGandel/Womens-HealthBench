from datetime import UTC, datetime

from sqlalchemy import create_engine, func, inspect, select, text

from app.database import Base
from app.migrate_mandatory_research import migrate
from app.migrate_wearables import WEARABLE_TABLES
from app.migrate_wearables import migrate as migrate_wearables
from app.models import (
    Account,
    CheckIn,
    ConsentRecord,
    ParticipantLink,
    ResearchEvent,
)


def test_wearable_migration_is_additive_and_idempotent(tmp_path) -> None:
    target = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    wearable_names = {table.name for table in WEARABLE_TABLES}
    for table in Base.metadata.sorted_tables:
        if table.name not in wearable_names:
            table.create(target)

    assert set(migrate_wearables(target)) == wearable_names
    assert migrate_wearables(target) == ()
    assert wearable_names <= set(inspect(target).get_table_names())


def test_wearable_migration_adds_temperature_delta_to_legacy_tables(tmp_path) -> None:
    target = create_engine(f"sqlite:///{tmp_path / 'legacy-temperature.db'}")
    Base.metadata.create_all(target)
    with target.begin() as connection:
        for table_name in (
            "health_wearable_daily_summaries",
            "research_wearable_daily_events",
        ):
            connection.execute(
                text(
                    f"ALTER TABLE {table_name} "
                    "RENAME COLUMN peripheral_temperature_delta_c "
                    "TO peripheral_temperature_c"
                )
            )

    changed = set(migrate_wearables(target))

    expected = {
        "health_wearable_daily_summaries.peripheral_temperature_delta_c",
        "research_wearable_daily_events.peripheral_temperature_delta_c",
    }
    assert changed == expected
    inspector = inspect(target)
    for table_name in (
        "health_wearable_daily_summaries",
        "research_wearable_daily_events",
    ):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert "peripheral_temperature_c" in columns
        assert "peripheral_temperature_delta_c" in columns
    assert migrate_wearables(target) == ()


def test_legacy_migration_is_dry_run_by_default_and_cascades_on_apply(
    session_factory,
) -> None:
    with session_factory() as session:
        session.execute(
            text(
                "ALTER TABLE health_checkins "
                "ADD COLUMN is_synthetic BOOLEAN NOT NULL DEFAULT 0"
            )
        )
        session.commit()
        account = Account(token_hash="legacy-token-hash")
        session.add(account)
        session.flush()
        link = ParticipantLink(account_id=account.id, day_zero=datetime.now(UTC).date())
        session.add(link)
        session.add(
            ConsentRecord(
                account_id=account.id,
                consent_version="2026-07-01",
                operational_accepted=True,
                research_opt_in=False,
                action="enrolled",
            )
        )
        session.flush()
        checkin = CheckIn(
            account_id=account.id,
            client_submission_id="legacy-checkin",
            observed_date=datetime.now(UTC).date(),
            period_status="none",
            cycle_day=None,
            sleep_hours=7,
            sleep_quality=3,
            stress=2,
            fatigue=2,
            brain_fog=1,
            headache=0,
            pelvic_pain=1,
            mood_disruption=1,
        )
        session.add(checkin)
        session.flush()
        session.execute(
            text("UPDATE health_checkins SET is_synthetic = true WHERE id = :id"),
            {"id": checkin.id},
        )
        session.add(
            ResearchEvent(
                research_id=link.research_id,
                source_checkin_id=checkin.id,
                day_in_study=0,
                period_status="none",
                cycle_day=None,
                sleep_hours=7,
                sleep_quality=3,
                stress=2,
                fatigue=2,
                brain_fog=1,
                headache=0,
                pelvic_pain=1,
                mood_disruption=1,
            )
        )
        session.commit()

        preview = migrate(session, apply=False)
        assert preview.accounts == 1
        assert preview.checkins == 1
        assert preview.research_rows == 1
        assert preview.legacy_demo_checkins == 1
        assert preview.legacy_schema_field is True
        assert session.scalar(select(func.count(Account.id))) == 1

        applied = migrate(session, apply=True)
        assert applied == preview
        assert "is_synthetic" not in {
            column["name"] for column in inspect(session.get_bind()).get_columns("health_checkins")
        }
        for model in (Account, ParticipantLink, ConsentRecord, CheckIn, ResearchEvent):
            assert session.scalar(select(func.count()).select_from(model)) == 0
