import hashlib
import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import Account

bearer = HTTPBearer(auto_error=False)


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_access_token() -> str:
    return secrets.token_urlsafe(32)


def require_account(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[Session, Depends(get_session)],
) -> Account:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")
    account = session.scalar(
        select(Account).where(Account.token_hash == hash_secret(credentials.credentials))
    )
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token")
    return account

