from pathlib import Path

from fastapi.testclient import TestClient

from ly_tb_automation.config import Settings
from ly_tb_automation.main import create_app


def test_health_and_dashboard(tmp_path: Path) -> None:
    settings = Settings(
        environment="test",
        host="127.0.0.1",
        port=8000,
        data_dir=tmp_path,
        log_level="WARNING",
        secret_key="test-secret",
    )

    with TestClient(create_app(settings)) as client:
        response = client.get("/health")
        dashboard = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    assert dashboard.status_code == 200
    assert "工作台" in dashboard.text
    assert "3 个国家 · 15 个城市" in dashboard.text


def test_destinations_page_lists_seed_data(tmp_path: Path) -> None:
    settings = Settings(
        environment="test",
        host="127.0.0.1",
        port=8000,
        data_dir=tmp_path,
        log_level="WARNING",
        secret_key="test-secret",
    )

    with TestClient(create_app(settings)) as client:
        response = client.get("/destinations")

    assert response.status_code == 200
    assert "东京" in response.text
    assert "富国岛" in response.text
