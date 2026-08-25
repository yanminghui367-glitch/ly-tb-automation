from pathlib import Path

from fastapi.testclient import TestClient

from ly_tb_automation.config import Settings
from ly_tb_automation.database import transaction
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


def test_product_batch_pages_and_draft_title_selection(tmp_path: Path) -> None:
    settings = Settings(
        environment="test",
        host="127.0.0.1",
        port=8000,
        data_dir=tmp_path,
        log_level="WARNING",
        secret_key="test-secret",
    )

    with TestClient(create_app(settings)) as client:
        empty_page = client.get("/products")
        created = client.post(
            "/product-batches",
            data={"scope": "ALL", "missing_only": "1"},
            follow_redirects=False,
        )
        batch_page = client.get(created.headers["location"])
        products_page = client.get("/products")

        with transaction(settings.database_path) as connection:
            product = connection.execute(
                "SELECT * FROM products WHERE product_code = 'CITY-JP-TOKYO'"
            ).fetchone()
            candidates = connection.execute(
                """
                SELECT * FROM title_candidates
                WHERE product_id = ?
                ORDER BY candidate_code
                """,
                (product["id"],),
            ).fetchall()

        detail = client.get(f"/products/{product['id']}")
        selected = client.post(
            f"/products/{product['id']}/title-selection",
            data={"candidate_id": candidates[0]["id"], "version": product["version"]},
            follow_redirects=False,
        )
        stale = client.post(
            f"/products/{product['id']}/title-selection",
            data={"candidate_id": candidates[1]["id"], "version": product["version"]},
        )

    assert empty_page.status_code == 200
    assert "当前输出不是淘宝合规结论" in empty_page.text
    assert created.status_code == 303
    assert created.headers["location"].startswith("/product-batches/")
    assert batch_page.status_code == 200
    assert "18/18" in batch_page.text
    assert products_page.status_code == 200
    assert "CITY-JP-TOKYO" in products_page.text
    assert detail.status_code == 200
    assert "东京中文导游地陪翻译包车接送机一日游商务陪同服务" in detail.text
    assert selected.status_code == 303
    assert stale.status_code == 409
    assert "PRODUCT_VERSION_CONFLICT" in stale.text
