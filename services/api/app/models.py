from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


def uuid_string() -> str:
    return str(uuid4())


class Invitation(Base):
    __tablename__ = "identity_invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_string)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Account(Base):
    __tablename__ = "identity_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_string)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    participant_link: Mapped[ParticipantLink] = relationship(
        back_populates="account", cascade="all, delete-orphan", uselist=False
    )
    consents: Mapped[list[ConsentRecord]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    checkins: Mapped[list[CheckIn]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class ParticipantLink(Base):
    __tablename__ = "identity_participant_links"

    research_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_string)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("identity_accounts.id", ondelete="CASCADE"), unique=True, index=True
    )
    day_zero: Mapped[date] = mapped_column(Date)

    account: Mapped[Account] = relationship(back_populates="participant_link")
    research_events: Mapped[list[ResearchEvent]] = relationship(
        back_populates="participant_link", cascade="all, delete-orphan"
    )


class ConsentRecord(Base):
    __tablename__ = "identity_consent_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("identity_accounts.id", ondelete="CASCADE"), index=True
    )
    consent_version: Mapped[str] = mapped_column(String(32))
    operational_accepted: Mapped[bool] = mapped_column(Boolean)
    research_opt_in: Mapped[bool] = mapped_column(Boolean)
    action: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    account: Mapped[Account] = relationship(back_populates="consents")


class CheckIn(Base):
    __tablename__ = "health_checkins"
    __table_args__ = (
        UniqueConstraint("account_id", "client_submission_id", name="uq_checkin_submission"),
        UniqueConstraint("account_id", "observed_date", name="uq_checkin_day"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_string)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("identity_accounts.id", ondelete="CASCADE"), index=True
    )
    client_submission_id: Mapped[str] = mapped_column(String(64))
    observed_date: Mapped[date] = mapped_column(Date)
    period_status: Mapped[str] = mapped_column(String(16))
    cycle_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_hours: Mapped[float] = mapped_column(Float)
    sleep_quality: Mapped[int] = mapped_column(Integer)
    stress: Mapped[int] = mapped_column(Integer)
    fatigue: Mapped[int] = mapped_column(Integer)
    brain_fog: Mapped[int] = mapped_column(Integer)
    headache: Mapped[int] = mapped_column(Integer)
    pelvic_pain: Mapped[int] = mapped_column(Integer)
    mood_disruption: Mapped[int] = mapped_column(Integer)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    account: Mapped[Account] = relationship(back_populates="checkins")


class ResearchEvent(Base):
    __tablename__ = "research_daily_events"
    __table_args__ = (
        UniqueConstraint("research_id", "day_in_study", name="uq_research_day"),
        UniqueConstraint(
            "research_id", "source_submission_id", name="uq_research_source_checkin"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_string)
    research_id: Mapped[str] = mapped_column(
        ForeignKey("identity_participant_links.research_id", ondelete="CASCADE"), index=True
    )
    # Keep the original database column name for compatibility with alpha databases,
    # but store the server-generated check-in UUID rather than a client identifier.
    source_checkin_id: Mapped[str] = mapped_column("source_submission_id", String(64))
    day_in_study: Mapped[int] = mapped_column(Integer)
    period_status: Mapped[str] = mapped_column(String(16))
    cycle_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_hours: Mapped[float] = mapped_column(Float)
    sleep_quality: Mapped[int] = mapped_column(Integer)
    stress: Mapped[int] = mapped_column(Integer)
    fatigue: Mapped[int] = mapped_column(Integer)
    brain_fog: Mapped[int] = mapped_column(Integer)
    headache: Mapped[int] = mapped_column(Integer)
    pelvic_pain: Mapped[int] = mapped_column(Integer)
    mood_disruption: Mapped[int] = mapped_column(Integer)

    participant_link: Mapped[ParticipantLink] = relationship(back_populates="research_events")
