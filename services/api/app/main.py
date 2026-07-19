from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_secret, new_access_token, require_account
from app.config import get_settings
from app.database import SessionLocal, create_tables, get_session
from app.forecasting import build_forecast
from app.models import Account, CheckIn, ConsentRecord, Invitation, ParticipantLink
from app.research import (
    contribute_existing_checkins,
    current_consent,
    is_checkin_contributed,
    rebuild_contributed_checkins,
    research_record_count,
    withdraw_research_rows,
)
from app.schemas import (
    AccountSummary,
    CheckInCreate,
    CheckInResponse,
    EnrollRequest,
    EnrollResponse,
    ForecastResponse,
    InvitationCheckRequest,
    InvitationCheckResponse,
    MessageResponse,
    ResearchConsentResponse,
    ResearchConsentUpdate,
)
from app.seed import ensure_demo_invitation, seed_demo_checkins

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_tables()
    with SessionLocal() as session:
        ensure_demo_invitation(session, settings)
    yield


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

    def is_reusable_demo_code(code: str) -> bool:
        # The seeded demo invitation stays usable for repeated demo enrollments.
        return settings.demo_mode and code == settings.demo_invite_code

    @api.post(
        "/v1/invitations/check",
        response_model=InvitationCheckResponse,
        tags=["participant"],
    )
    def check_invitation(
        payload: InvitationCheckRequest,
        session: Annotated[Session, Depends(get_session)],
    ) -> InvitationCheckResponse:
        invitation = session.scalar(
            select(Invitation).where(
                Invitation.code_hash == hash_secret(payload.invitation_code)
            )
        )
        if invitation is None or (
            invitation.used_at is not None
            and not is_reusable_demo_code(payload.invitation_code)
        ):
            return InvitationCheckResponse(
                valid=False, detail="Invitation is invalid or already used"
            )
        expires_at = invitation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= datetime.now(UTC):
            return InvitationCheckResponse(valid=False, detail="Invitation has expired")
        return InvitationCheckResponse(valid=True)

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
        if payload.consent_version != settings.consent_version:
            raise HTTPException(status_code=409, detail="Consent version is no longer current")

        invitation = session.scalar(
            select(Invitation)
            .where(Invitation.code_hash == hash_secret(payload.invitation_code))
            .with_for_update()
        )
        now = datetime.now(UTC)
        if invitation is None or (
            invitation.used_at is not None
            and not is_reusable_demo_code(payload.invitation_code)
        ):
            raise HTTPException(status_code=403, detail="Invitation is invalid or already used")
        expires_at = invitation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= now:
            raise HTTPException(status_code=403, detail="Invitation has expired")

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
                research_opt_in=payload.research_opt_in,
                action="enrolled",
            )
        )
        if not is_reusable_demo_code(payload.invitation_code):
            invitation.used_at = now
        seeded = bool(payload.seed_demo_history and settings.demo_mode)
        if seeded:
            seed_demo_checkins(session, account.id)
        session.commit()
        return EnrollResponse(
            access_token=token,
            consent_version=settings.consent_version,
            research_opt_in=payload.research_opt_in,
            demo_history_seeded=seeded,
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
        account: Annotated[Account, Depends(require_account)],
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
        consent = current_consent(session, account.id)
        contributed = consent.research_opt_in
        if contributed:
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
            research_contributed=contributed,
            queued_at=checkin.created_at,
        )

    @api.get("/v1/forecast", response_model=ForecastResponse, tags=["forecast"])
    def get_forecast(
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> ForecastResponse:
        checkins = session.scalars(
            select(CheckIn)
            .where(CheckIn.account_id == account.id)
            .order_by(CheckIn.observed_date.asc())
        ).all()
        return build_forecast(checkins)

    @api.put(
        "/v1/research-consent",
        response_model=ResearchConsentResponse,
        tags=["privacy"],
    )
    def update_research_consent(
        payload: ResearchConsentUpdate,
        session: Annotated[Session, Depends(get_session)],
        account: Annotated[Account, Depends(require_account)],
    ) -> ResearchConsentResponse:
        if payload.consent_version != settings.consent_version:
            raise HTTPException(status_code=409, detail="Consent version is no longer current")
        record = ConsentRecord(
            account_id=account.id,
            consent_version=payload.consent_version,
            operational_accepted=True,
            research_opt_in=payload.research_opt_in,
            action="research_opt_in" if payload.research_opt_in else "research_withdrawal",
        )
        session.add(record)
        contributed = 0
        if payload.research_opt_in and payload.contribute_existing:
            contributed = contribute_existing_checkins(session, account)
        if not payload.research_opt_in:
            withdraw_research_rows(session, account)
        session.commit()
        return ResearchConsentResponse(
            research_opt_in=payload.research_opt_in,
            effective_at=record.created_at,
            contributed_records=contributed,
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
        return AccountSummary(
            research_opt_in=consent.research_opt_in,
            consent_version=consent.consent_version,
            checkin_count=checkin_count,
            research_record_count=research_record_count(session, account),
        )

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
