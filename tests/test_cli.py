from pathlib import Path
from unittest.mock import Mock

import pytest

from ly_tb_automation import cli


def test_run_uses_application_bind_settings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LYTB_ENVIRONMENT", "test")
    monkeypatch.setenv("LYTB_HOST", "127.0.0.9")
    monkeypatch.setenv("LYTB_PORT", "8123")
    monkeypatch.setenv("LYTB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LYTB_LOG_LEVEL", "WARNING")
    monkeypatch.setenv("LYTB_SECRET_KEY", "test-secret")
    run_uvicorn = Mock()
    monkeypatch.setattr("ly_tb_automation.cli.uvicorn.run", run_uvicorn)

    cli.run()

    run_uvicorn.assert_called_once_with(
        "ly_tb_automation.main:app",
        host="127.0.0.9",
        port=8123,
        reload=False,
    )
