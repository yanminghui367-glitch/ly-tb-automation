from pathlib import Path

import pytest

from ly_tb_automation.config import ConfigurationError, Settings


def test_settings_use_safe_local_defaults(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in (
        "LYTB_ENVIRONMENT",
        "LYTB_HOST",
        "LYTB_PORT",
        "LYTB_LOG_LEVEL",
        "LYTB_SECRET_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LYTB_DATA_DIR", str(tmp_path))

    settings = Settings.from_env()

    assert settings.environment == "development"
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.database_path == tmp_path / "database" / "ly_tb.db"


@pytest.mark.parametrize("value", ["0", "65536", "not-a-number"])
def test_invalid_port_is_rejected(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("LYTB_PORT", value)

    with pytest.raises(ConfigurationError, match="LYTB_PORT"):
        Settings.from_env()


@pytest.mark.parametrize(
    "secret_key",
    [None, "replace-with-a-long-random-value", "too-short"],
)
def test_production_rejects_insecure_secret(
    monkeypatch: pytest.MonkeyPatch, secret_key: str | None
) -> None:
    monkeypatch.setenv("LYTB_ENVIRONMENT", "production")
    if secret_key is None:
        monkeypatch.delenv("LYTB_SECRET_KEY", raising=False)
    else:
        monkeypatch.setenv("LYTB_SECRET_KEY", secret_key)

    with pytest.raises(ConfigurationError, match="LYTB_SECRET_KEY"):
        Settings.from_env()
