import hashlib
import json
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_secret, new_access_token, require_account
from app.config import get_settings
from app.cycle import build_cycle_summary
from app.database import create_tables, get_session
from app.forecasting import build_forecast
from app.models import (
    Account,
    CheckIn,
    ConsentRecord,
    CycleDay,
    CycleSyncReceipt,
    CycleTrackingPreference,
    ParticipantLink,
    WearableConnection,
    WearableDailySummary,
    WearableSyncReceipt,
)
from app.research import (
    current_consent,
    is_checkin_contributed,
    rebuild_contributed_checkins,
    rebuild_research_timeline,
    research_record_count,
)
from app.schemas import (
    AccountSummary,
    CheckInCreate,
    CheckInResponse,
    ConsentResponse,
    ConsentUpdate,
    CycleDeleteResponse,
    CycleSyncRequest,
    CycleSyncResponse,
    CycleTrackingEnableRequest,
    CycleTrackingSummary,
    EnrollRequest,
    EnrollResponse,
    ForecastResponse,
    MessageResponse,
    WearableDeleteResponse,
    WearableSyncRequest,
    WearableSyncResponse,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_tables()
    yield


def require_current_consent(
    session: Annotated[Session, Depends(get_session)],
    account: Annotated[Account, Depends(require_account)],
) -> Account:
    consent = current_consent(session, account.id)
    if (
        consent.consent_version != settings.consent_version
        or not consent.operational_accepted
        or not consent.research_opt_in
    ):
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="Current operational and research consent is required",
        )
    return account


def cycle_summary_for_account(
    session: Session,
    account: Account,
    local_today: date,
) -> CycleTrackingSummary:
    prune_expired_cycle_days(session, account.id, local_today)
    enabled = session.get(CycleTrackingPreference, account.id) is not None
    earliest = local_today - timedelta(days=119)
    days = session.scalars(
        select(CycleDay)
        .where(
            CycleDay.account_id == account.id,
            CycleDay.observed_date >= earliest,
            CycleDay.observed_date <= local_today,
        )
        .order_by(CycleDay.observed_date.asc())
    ).all()
    checkins = session.scalars(
        select(CheckIn)
        .where(
            CheckIn.account_id == account.id,
            CheckIn.observed_date >= earliest,
            CheckIn.observed_date <= local_today,
        )
        .order_by(CheckIn.observed_date.asc())
    ).all()
    return build_cycle_summary(
        enabled=enabled,
        days=list(days),
        checkins=list(checkins),
        today=local_today,
    )


def validated_local_today(value: date | None) -> date:
    utc_today = datetime.now(UTC).date()
    local_today = value or utc_today
    if local_today < utc_today - timedelta(days=1) or local_today > utc_today + timedelta(days=1):
        raise HTTPException(
            status_code=422,
            detail="Local calendar date must be within one day of the server UTC date",
        )
    return local_today


def prune_expired_cycle_days(
    session: Session,
    account_id: str,
    local_today: date,
) -> None:
    earliest = local_today - timedelta(days=119)
    session.execute(
        delete(CycleDay).where(
            CycleDay.account_id == account_id,
            CycleDay.observed_date < earliest,
        )
    )
    session.flush()


def create_app() -> FastAPI:
    api = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=(
            "Private experimental wellness forecasting. Request bodies and "
            "authorization headers must never be logged."
        ),
        lifespan=lifespan,
    )
    origins = ["*"] if settings.allowed_origins == "*" else settings.allowed_origins.split(",")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=origins != ["*"],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @api.middleware("http")
    async def prevent_sensitive_response_caching(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    @api.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @api.post(
        "/v1/enroll",
        response_model=EnrollResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["participant"],
    )
    def enroll(
        payload: EnrollRequest,
        session: Annotated[Session, Depends(get_session)],
    ) -> EnrollResponse:
        if not payload.adult_confirmed:
            raise HTTPException(status_code=422, detail="Participants must confirm they are adults")
        if not payload.operational_consent:
            raise HTTPException(
                status_code=422,
                detail="Operational processing consent is required",
            )
        if not payload.research_consent:
            raise HTTPException(
                status_code=422,
                detail="Research participation consent is required",
            )
        if payload.consent_version != settings.consent_version:
            raise HTTPException(status_code=409, detail="Consent version is no longer current")

        token = new_access_token()
        account = Account(token_hash=hash_secret(token))
        session.add(account)
        session.flush()
        session.add(ParticipantLink(account_id=account.id, day_zero=date.today()))
        session.add(
            ConsentRecord(
                account_id=account.id,
                consent_version=payload.consent_version,
                operational_accepted=True,
                research_opt_in=True,
                action="enrolled",
            )
        )
        session.commit()
        return EnrollResponse(
            access_token=token,
            consent_version=settings.consent_version,
        )

    @api.put(
        "/v1/consent",
        response_model=ConsentResponse,
        tags=["participant"],
    )
    def update_consent(
        payload: ConsentUpdate,
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> ConsentResponse:
        if payload.consent_version != settings.consent_version:
            raise HTTPException(status_code=409, detail="Consent version is no longer current")
        if not payload.operational_consent or not payload.research_consent:
            raise HTTPException(
                status_code=422,
                detail="Operational and research consent are required to participate",
            )
        record = ConsentRecord(
            account_id=account.id,
            consent_version=payload.consent_version,
            operational_accepted=True,
            research_opt_in=True,
            action="terms_reaccepted",
        )
        session.add(record)
        session.commit()
        return ConsentResponse(
            consent_current=True,
            consent_version=record.consent_version,
            effective_at=record.created_at,
        )

    @api.post(
        "/v1/check-ins",
        response_model=CheckInResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["check-ins"],
    )
    def create_checkin(
        payload: CheckInCreate,
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_current_consent)],
        response: Response,
    ) -> CheckInResponse:
        if payload.observed_date > date.today():
            raise HTTPException(status_code=422, detail="Check-in date cannot be in the future")
        existing = session.scalar(
            select(CheckIn).where(
                CheckIn.account_id == account.id,
                CheckIn.client_submission_id == payload.client_submission_id,
            )
        )
        if existing is not None:
            incoming = payload.model_dump()
            has_same_payload = all(
                getattr(existing, field) == value for field, value in incoming.items()
            )
            if not has_same_payload:
                raise HTTPException(
                    status_code=409,
                    detail="Idempotency key was already used with a different check-in",
                )
            response.status_code = status.HTTP_200_OK
            return CheckInResponse(
                id=existing.id,
                accepted=True,
                duplicate=True,
                research_contributed=is_checkin_contributed(
                    session,
                    account,
                    existing,
                ),
                queued_at=existing.created_at,
            )

        day_existing = session.scalar(
            select(CheckIn).where(
                CheckIn.account_id == account.id,
                CheckIn.observed_date == payload.observed_date,
            )
        )
        if day_existing is not None:
            raise HTTPException(status_code=409, detail="A check-in already exists for this date")

        checkin = CheckIn(account_id=account.id, **payload.model_dump())
        session.add(checkin)
        session.flush()
        rebuild_contributed_checkins(session, account, added_checkin=checkin)
        try:
            session.commit()
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Check-in conflicts with an existing row",
            ) from error
        return CheckInResponse(
            id=checkin.id,
            accepted=True,
            duplicate=False,
            research_contributed=True,
            queued_at=checkin.created_at,
        )

    @api.get("/v1/forecast", response_model=ForecastResponse, tags=["forecast"])
    def get_forecast(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_current_consent)],
    ) -> ForecastResponse:
        checkins = session.scalars(
            select(CheckIn)
            .where(CheckIn.account_id == account.id)
            .order_by(CheckIn.observed_date.asc())
        ).all()
        latest = checkins[-1] if checkins else None
        cycle_status = None
        if latest is not None and account.cycle_tracking_preference is not None:
            matching_cycle_day = session.scalar(
                select(CycleDay).where(
                    CycleDay.account_id == account.id,
                    CycleDay.observed_date == latest.observed_date,
                )
            )
            if matching_cycle_day is not None:
                cycle_status = matching_cycle_day.period_status
        return build_forecast(checkins, cycle_status=cycle_status)

    @api.put(
        "/v1/cycle-tracking",
        response_model=CycleTrackingSummary,
        tags=["cycle"],
    )
    def enable_cycle_tracking(
        payload: CycleTrackingEnableRequest,
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_current_consent)],
    ) -> CycleTrackingSummary:
        local_today = validated_local_today(payload.local_today)
        if account.cycle_tracking_preference is None:
            session.add(CycleTrackingPreference(account_id=account.id))
            session.commit()
        summary = cycle_summary_for_account(session, account, local_today)
        session.commit()
        return summary

    @api.get(
        "/v1/cycle-tracking",
        response_model=CycleTrackingSummary,
        tags=["cycle"],
    )
    def get_cycle_tracking(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_current_consent)],
        local_today: date | None = None,
    ) -> CycleTrackingSummary:
        summary = cycle_summary_for_account(
            session,
            account,
            validated_local_today(local_today),
        )
        session.commit()
        return summary

    @api.post(
        "/v1/cycle-days:sync",
        response_model=CycleSyncResponse,
        tags=["cycle"],
    )
    def sync_cycle_days(
        payload: CycleSyncRequest,
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_current_consent)],
    ) -> CycleSyncResponse:
        if account.cycle_tracking_preference is None:
            raise HTTPException(status_code=409, detail="Cycle tracking is not enabled")
        today = validated_local_today(payload.local_today)
        earliest = today - timedelta(days=119)
        for record in payload.records:
            if record.observed_date > today:
                raise HTTPException(status_code=422, detail="Cycle date cannot be in the future")
            if record.observed_date < earliest:
                raise HTTPException(
                    status_code=422,
                    detail="Cycle history is limited to the most recent 120 calendar days",
                )

        prune_expired_cycle_days(session, account.id, today)
        canonical = json.dumps(
            payload.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        )
        payload_hash = hashlib.sha256(canonical.encode()).hexdigest()
        existing_receipt = session.scalar(
            select(CycleSyncReceipt).where(
                CycleSyncReceipt.account_id == account.id,
                CycleSyncReceipt.sync_id == payload.sync_id,
            )
        )
        if existing_receipt is not None:
            if existing_receipt.payload_hash != payload_hash:
                raise HTTPException(
                    status_code=409,
                    detail="Sync identifier was already used with different cycle data",
                )
            return CycleSyncResponse(
                accepted_days=existing_receipt.accepted_days,
                deleted_days=existing_receipt.deleted_days,
                duplicate=True,
            )

        accepted_days = 0
        deleted_days = 0
        now = datetime.now(UTC)
        for record in payload.records:
            existing_day = session.scalar(
                select(CycleDay).where(
                    CycleDay.account_id == account.id,
                    CycleDay.observed_date == record.observed_date,
                )
            )
            if record.period_status is None:
                if existing_day is not None:
                    session.delete(existing_day)
                    deleted_days += 1
                continue
            if existing_day is None:
                session.add(
                    CycleDay(
                        account_id=account.id,
                        observed_date=record.observed_date,
                        period_status=record.period_status,
                    )
                )
            else:
                existing_day.period_status = record.period_status
                existing_day.updated_at = now
            accepted_days += 1

        session.add(
            CycleSyncReceipt(
                account_id=account.id,
                sync_id=payload.sync_id,
                payload_hash=payload_hash,
                accepted_days=accepted_days,
                deleted_days=deleted_days,
                created_at=now,
            )
        )
        try:
            session.commit()
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Cycle sync conflicts with an existing batch",
            ) from error
        return CycleSyncResponse(
            accepted_days=accepted_days,
            deleted_days=deleted_days,
            duplicate=False,
        )

    @api.delete(
        "/v1/cycle-tracking",
        response_model=CycleDeleteResponse,
        tags=["cycle"],
    )
    def delete_cycle_tracking(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> CycleDeleteResponse:
        deleted_days = int(
            session.scalar(
                select(func.count(CycleDay.id)).where(CycleDay.account_id == account.id)
            )
            or 0
        )
        session.execute(delete(CycleDay).where(CycleDay.account_id == account.id))
        session.execute(
            delete(CycleSyncReceipt).where(CycleSyncReceipt.account_id == account.id)
        )
        session.execute(
            delete(CycleTrackingPreference).where(
                CycleTrackingPreference.account_id == account.id
            )
        )
        session.commit()
        return CycleDeleteResponse(
            deleted_days=deleted_days,
            message="Cycle tracking was disabled and cycle history was deleted",
        )

    @api.post(
        "/v1/wearable-days:sync",
        response_model=WearableSyncResponse,
        tags=["wearables"],
    )
    def sync_wearable_days(
        payload: WearableSyncRequest,
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_current_consent)],
    ) -> WearableSyncResponse:
        utc_today = datetime.now(UTC).date()
        # A local 31-day window may be one date ahead of or behind UTC at its edges.
        earliest = utc_today - timedelta(days=31)
        latest = utc_today + timedelta(days=1)
        platforms = {record.platform for record in payload.records}
        if len(platforms) > 1:
            raise HTTPException(
                status_code=422,
                detail="A wearable sync batch must contain a single platform",
            )
        for record in payload.records:
            if record.observed_date > latest:
                raise HTTPException(
                    status_code=422,
                    detail="Wearable date is outside the current local-calendar window",
                )
            if record.observed_date < earliest:
                raise HTTPException(
                    status_code=422,
                    detail="Wearable sync is limited to the most recent 31 calendar days",
                )

        canonical = json.dumps(
            payload.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        )
        payload_hash = hashlib.sha256(canonical.encode()).hexdigest()
        existing_receipt = session.scalar(
            select(WearableSyncReceipt).where(
                WearableSyncReceipt.account_id == account.id,
                WearableSyncReceipt.sync_id == payload.sync_id,
            )
        )
        if existing_receipt is not None:
            if existing_receipt.payload_hash != payload_hash:
                raise HTTPException(
                    status_code=409,
                    detail="Sync identifier was already used with a different payload",
                )
            connection = account.wearable_connection
            return WearableSyncResponse(
                accepted_days=existing_receipt.accepted_days,
                deleted_days=existing_receipt.deleted_days,
                duplicate=True,
                last_synced_at=(
                    connection.last_synced_at
                    if connection is not None
                    else existing_receipt.created_at
                ),
            )

        platform = next(iter(platforms), None)
        now = datetime.now(UTC)
        connection = account.wearable_connection
        if platform is not None:
            if connection is None:
                connection = WearableConnection(
                    account_id=account.id,
                    platform=platform,
                    connected_at=now,
                    last_synced_at=now,
                )
                session.add(connection)
            else:
                connection.platform = platform
                connection.last_synced_at = now

        accepted_days = 0
        deleted_days = 0
        for record in payload.records:
            existing_day = session.scalar(
                select(WearableDailySummary).where(
                    WearableDailySummary.account_id == account.id,
                    WearableDailySummary.observed_date == record.observed_date,
                )
            )
            if not record.has_metrics():
                if existing_day is not None:
                    session.delete(existing_day)
                    deleted_days += 1
                continue

            values = record.model_dump(exclude={"observed_date", "platform"})
            if existing_day is None:
                session.add(
                    WearableDailySummary(
                        account_id=account.id,
                        observed_date=record.observed_date,
                        platform=record.platform,
                        **values,
                    )
                )
            else:
                existing_day.platform = record.platform
                for field, value in values.items():
                    setattr(existing_day, field, value)
                existing_day.updated_at = now
            accepted_days += 1

        session.flush()
        rebuild_research_timeline(session, account)
        receipt = WearableSyncReceipt(
            account_id=account.id,
            sync_id=payload.sync_id,
            payload_hash=payload_hash,
            accepted_days=accepted_days,
            deleted_days=deleted_days,
            created_at=now,
        )
        session.add(receipt)
        try:
            session.commit()
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Wearable sync conflicts with an existing batch",
            ) from error
        return WearableSyncResponse(
            accepted_days=accepted_days,
            deleted_days=deleted_days,
            duplicate=False,
            last_synced_at=now,
        )

    @api.delete(
        "/v1/wearable-data",
        response_model=WearableDeleteResponse,
        tags=["wearables"],
    )
    def delete_wearable_data(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> WearableDeleteResponse:
        deleted_days = int(
            session.scalar(
                select(func.count(WearableDailySummary.id)).where(
                    WearableDailySummary.account_id == account.id
                )
            )
            or 0
        )
        session.execute(
            delete(WearableDailySummary).where(WearableDailySummary.account_id == account.id)
        )
        session.execute(
            delete(WearableSyncReceipt).where(WearableSyncReceipt.account_id == account.id)
        )
        session.execute(
            delete(WearableConnection).where(WearableConnection.account_id == account.id)
        )
        session.flush()
        rebuild_research_timeline(session, account)
        session.commit()
        return WearableDeleteResponse(
            deleted_days=deleted_days,
            message="Imported wearable data was disconnected and deleted",
        )

    @api.get("/v1/account", response_model=AccountSummary, tags=["privacy"])
    def account_summary(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> AccountSummary:
        consent = current_consent(session, account.id)
        checkin_count = int(
            session.scalar(
                select(func.count(CheckIn.id)).where(CheckIn.account_id == account.id)
            )
            or 0
        )
        wearable_day_count = int(
            session.scalar(
                select(func.count(WearableDailySummary.id)).where(
                    WearableDailySummary.account_id == account.id
                )
            )
            or 0
        )
        session.execute(
            delete(CycleDay).where(
                CycleDay.account_id == account.id,
                CycleDay.observed_date
                < datetime.now(UTC).date() - timedelta(days=120),
            )
        )
        session.flush()
        cycle_day_count = int(
            session.scalar(
                select(func.count(CycleDay.id)).where(CycleDay.account_id == account.id)
            )
            or 0
        )
        connection = account.wearable_connection
        summary = AccountSummary(
            consent_current=(
                consent.consent_version == settings.consent_version
                and consent.operational_accepted
                and consent.research_opt_in
            ),
            consent_version=consent.consent_version,
            checkin_count=checkin_count,
            research_record_count=research_record_count(session, account),
            wearable_connected=connection is not None,
            wearable_platform=connection.platform if connection is not None else None,
            wearable_day_count=wearable_day_count,
            wearable_last_synced_at=(
                connection.last_synced_at if connection is not None else None
            ),
            cycle_tracking_enabled=account.cycle_tracking_preference is not None,
            cycle_day_count=cycle_day_count,
        )
        session.commit()
        return summary

    @api.delete("/v1/account", response_model=MessageResponse, tags=["privacy"])
    def delete_account(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> MessageResponse:
        session.delete(account)
        session.commit()
        return MessageResponse(message="Account and associated records deleted")

    return api


app = create_app()
