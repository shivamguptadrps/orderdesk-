from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"  # dev, test or prod
    database_url: str = "postgresql+asyncpg://orderdesk:orderdesk_dev@localhost:5432/orderdesk"

    jwt_secret: str = "change-me"
    jwt_access_days: int = 30
    jwt_refresh_days: int = 180

    otp_mode: str = "log"  # "log" or "whatsapp"
    otp_ttl_minutes: int = 5
    otp_max_attempts: int = 5
    otp_rate_limit_count: int = 3
    otp_rate_limit_window_minutes: int = 10

    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_otp_template: str = ""
    whatsapp_template_language: str = "en"
    whatsapp_api_version: str = "v23.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
