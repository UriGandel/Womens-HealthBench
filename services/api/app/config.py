from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Tomorrow, Gently API"
    database_url: str = "sqlite:///./healthbench.db"
    consent_version: str = "2026-07-19-intraday-cycle-v2"
    admin_export_key: str | None = None
    allowed_origins: str = "*"
    phase_model_v01_path: str | None = None
    phase_model_v02_path: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
