import argparse
import hmac
import os
from dataclasses import dataclass

from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Account, CheckIn, ResearchEvent, ResearchWearableDay
from app.research import current_consent

DELETION_ACKNOWLEDGEMENT = "DELETE-OPTED-OUT-ACCOUNTS"


@dataclass(frozen=True)
class MigrationSummary:
    accounts: int
    checkins: int
    research_rows: int
    legacy_demo_checkins: int
    legacy_schema_field: bool


def opted_out_accounts(session: Session) -> list[Account]:
    accounts = session.scalars(select(Account).order_by(Account.created_at, Account.id)).all()
    return [
        account
        for account in accounts
        if not current_consent(session, account.id).research_opt_in
    ]


def summarize(accounts: list[Account], session: Session) -> MigrationSummary:
    bind = session.get_bind()
    table_names = set(inspect(bind).get_table_names())
    legacy_schema_field = any(
        column["name"] == "is_synthetic"
        for column in inspect(bind).get_columns("health_checkins")
    )
    legacy_demo_checkins = (
        int(
            session.scalar(
                text("SELECT COUNT(*) FROM health_checkins WHERE is_synthetic = true")
            )
            or 0
        )
        if legacy_schema_field
        else 0
    )
    account_ids = [account.id for account in accounts]
    research_ids = [account.participant_link.research_id for account in accounts]
    if not account_ids:
        return MigrationSummary(
            accounts=0,
            checkins=0,
            research_rows=0,
            legacy_demo_checkins=legacy_demo_checkins,
            legacy_schema_field=legacy_schema_field,
        )
    checkins = int(
        session.scalar(select(func.count(CheckIn.id)).where(CheckIn.account_id.in_(account_ids)))
        or 0
    )
    checkin_research_rows = int(
        session.scalar(
            select(func.count(ResearchEvent.id)).where(
                ResearchEvent.research_id.in_(research_ids)
            )
        )
        or 0
    )
    wearable_research_rows = (
        int(
            session.scalar(
                select(func.count(ResearchWearableDay.id)).where(
                    ResearchWearableDay.research_id.in_(research_ids)
                )
            )
            or 0
        )
        if "research_wearable_daily_events" in table_names
        else 0
    )
    return MigrationSummary(
        accounts=len(account_ids),
        checkins=checkins,
        research_rows=checkin_research_rows + wearable_research_rows,
        legacy_demo_checkins=legacy_demo_checkins,
        legacy_schema_field=legacy_schema_field,
    )


def migrate(session: Session, *, apply: bool) -> MigrationSummary:
    accounts = opted_out_accounts(session)
    summary = summarize(accounts, session)
    if apply:
        account_ids = [account.id for account in accounts]
        if account_ids:
            session.execute(delete(Account).where(Account.id.in_(account_ids)))
        if summary.legacy_schema_field:
            session.execute(
                text("DELETE FROM health_checkins WHERE is_synthetic = true")
            )
            session.execute(text("ALTER TABLE health_checkins DROP COLUMN is_synthetic"))
        session.commit()
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete legacy accounts that declined research participation"
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--acknowledge")
    parser.add_argument("--key", required=True)
    args = parser.parse_args()

    expected = os.environ.get("ADMIN_MIGRATION_KEY")
    if not expected or not hmac.compare_digest(args.key, expected):
        raise SystemExit("Invalid administrator migration key")
    if args.apply and args.acknowledge != DELETION_ACKNOWLEDGEMENT:
        raise SystemExit(
            f"--apply requires --acknowledge {DELETION_ACKNOWLEDGEMENT}"
        )

    with SessionLocal() as session:
        summary = migrate(session, apply=args.apply)
    mode = "Deleted" if args.apply else "Would delete"
    print(
        f"{mode} {summary.accounts} accounts, {summary.checkins} check-ins, "
        f"and {summary.research_rows} research rows."
    )
    schema_mode = "Dropped" if args.apply else "Would drop"
    if summary.legacy_schema_field:
        print(f"{mode} {summary.legacy_demo_checkins} legacy demo check-ins.")
        print(f"{schema_mode} legacy health_checkins.is_synthetic column.")


if __name__ == "__main__":
    main()
