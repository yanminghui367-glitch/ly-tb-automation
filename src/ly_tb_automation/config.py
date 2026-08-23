"""Environment-based application configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class ConfigurationError(ValueError):
    """Raised when an environment variable contains an invalid value."""


def _read_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as exc:
        raise ConfigurationError("LYTB_PORT 必须是整数") from exc
    if not 1 <= port <= 65535:
        raise ConfigurationError("LYTB_PORT 必须在 1 到 65535 之间")
    return port


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings loaded from environment variables."""

    environment: str
    host: str
    port: int
    data_dir: Path
    log_level: str
    secret_key: str

    @property
    def database_path(self) -> Path:
        return self.data_dir / "database" / "ly_tb.db"

    @classmethod
    def from_env(cls) -> Settings:
        environment = os.getenv("LYTB_ENVIRONMENT", "development").strip().lower()
        host = os.getenv("LYTB_HOST", "127.0.0.1").strip()
        data_dir = Path(os.getenv("LYTB_DATA_DIR", "./data")).expanduser().resolve()
        log_level = os.getenv("LYTB_LOG_LEVEL", "INFO").strip().upper()
        secret_key = os.getenv("LYTB_SECRET_KEY", "development-only-change-me")

        if environment not in {"development", "test", "production"}:
            raise ConfigurationError("LYTB_ENVIRONMENT 必须是 development、test 或 production")
        if not host:
            raise ConfigurationError("LYTB_HOST 不能为空")
        if log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ConfigurationError("LYTB_LOG_LEVEL 不是有效日志级别")
        if environment == "production" and secret_key == "development-only-change-me":
            raise ConfigurationError("生产环境必须设置 LYTB_SECRET_KEY")

        return cls(
            environment=environment,
            host=host,
            port=_read_port(os.getenv("LYTB_PORT", "8000")),
            data_dir=data_dir,
            log_level=log_level,
            secret_key=secret_key,
        )
