import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest

from ly_tb_automation import products as product_service
from ly_tb_automation.database import migrate, transaction
from ly_tb_automation.products import (
    GenerationOutcome,
    ProductTaskError,
    create_product_batch,
    get_product_batch,
    list_batch_jobs,
    product_counts,
    retry_failed_product_jobs,
    select_title_candidate,
)


def initialized_database(tmp_path: Path) -> Path:
    database_path = tmp_path / "app.db"
    migrate(database_path)
    return database_path


def test_first_batch_creates_exactly_eighteen_deterministic_drafts(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)

    result = create_product_batch(database_path, scope="ALL", missing_only=True)

    assert result.created is True
    batch = get_product_batch(database_path, result.batch_id)
    assert batch["status"] == "COMPLETED"
    assert (batch["target_count"], batch["succeeded_count"], batch["failed_count"]) == (
        18,
        18,
        0,
    )
    assert product_counts(database_path) == {
        "total": 18,
        "countries": 3,
        "cities": 15,
        "selected": 0,
    }
    with transaction(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM title_candidates").fetchone()[0] == 36
        assert connection.execute("SELECT COUNT(*) FROM product_services").fetchone()[0] == 144
        tokyo_titles = connection.execute(
            """
            SELECT title FROM title_candidates
            JOIN products ON products.id = title_candidates.product_id
            WHERE products.product_code = 'CITY-JP-TOKYO'
            ORDER BY candidate_code
            """
        ).fetchall()
    assert [row["title"] for row in tokyo_titles] == [
        "东京中文导游地陪翻译包车接送机一日游商务陪同服务",
        "日本东京旅游地陪中文导游翻译接送机包车定制服务",
    ]


def test_same_full_input_reuses_batch_without_duplicate_rows(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)

    first = create_product_batch(database_path, scope="ALL", missing_only=False)
    second = create_product_batch(database_path, scope="ALL", missing_only=False)

    assert first.created is True
    assert second == type(second)(first.batch_id, first.batch_code, False)
    with transaction(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM product_batches").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM generation_jobs").fetchone()[0] == 18
        assert connection.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 18
        assert connection.execute("SELECT COUNT(*) FROM title_candidates").fetchone()[0] == 36


def test_missing_only_batch_reports_when_nothing_is_missing(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    create_product_batch(database_path, scope="ALL", missing_only=True)

    with pytest.raises(ProductTaskError) as error:
        create_product_batch(database_path, scope="ALL", missing_only=True)

    assert error.value.code == "NO_PRODUCT_TARGETS"


def test_concurrent_duplicate_batch_request_is_idempotent(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda _index: create_product_batch(database_path, scope="ALL", missing_only=False),
                range(2),
            )
        )

    assert {result.batch_id for result in results} == {results[0].batch_id}
    assert sorted(result.created for result in results) == [False, True]
    with transaction(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM product_batches").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM generation_jobs").fetchone()[0] == 18
        assert connection.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 18


def test_one_failed_job_does_not_rollback_others_and_can_be_retried(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    database_path = initialized_database(tmp_path)
    original = product_service._generate_product

    def fail_tokyo(connection: sqlite3.Connection, job: sqlite3.Row) -> GenerationOutcome:
        snapshot: dict[str, Any] = json.loads(job["input_snapshot"])
        if snapshot["target"]["product_code"] == "CITY-JP-TOKYO":
            raise ProductTaskError("INJECTED_TEST_FAILURE", "模拟单任务失败")
        return original(connection, job)

    monkeypatch.setattr(product_service, "_generate_product", fail_tokyo)
    result = create_product_batch(database_path, scope="ALL", missing_only=False)

    batch = get_product_batch(database_path, result.batch_id)
    assert batch["status"] == "PARTIAL_FAILED"
    assert (batch["succeeded_count"], batch["failed_count"]) == (17, 1)
    assert product_counts(database_path)["total"] == 17

    monkeypatch.setattr(product_service, "_generate_product", original)
    failed_batch_version = batch["execution_version"]
    retry_failed_product_jobs(
        database_path,
        result.batch_id,
        expected_execution_version=failed_batch_version,
    )

    batch = get_product_batch(database_path, result.batch_id)
    failed_job = [
        job
        for job in list_batch_jobs(database_path, result.batch_id)
        if job["target_code"] == "CITY-JP-TOKYO"
    ][0]
    assert batch["status"] == "COMPLETED"
    assert (batch["succeeded_count"], batch["failed_count"]) == (18, 0)
    assert failed_job["status"] == "SUCCEEDED"
    assert failed_job["attempt_count"] == 2
    assert product_counts(database_path)["total"] == 18
    with pytest.raises(ProductTaskError) as stale_retry:
        retry_failed_product_jobs(
            database_path,
            result.batch_id,
            expected_execution_version=failed_batch_version,
        )
    assert stale_retry.value.code == "BATCH_VERSION_CONFLICT"


def test_pending_batch_can_resume_after_interruption(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    database_path = initialized_database(tmp_path)
    original_runner = product_service.run_product_batch
    monkeypatch.setattr(product_service, "run_product_batch", lambda *_args, **_kwargs: None)

    result = create_product_batch(database_path, scope="ALL", missing_only=False)
    assert get_product_batch(database_path, result.batch_id)["status"] == "PENDING"
    assert {job["status"] for job in list_batch_jobs(database_path, result.batch_id)} == {"PENDING"}

    monkeypatch.setattr(product_service, "run_product_batch", original_runner)
    original_runner(
        database_path,
        result.batch_id,
        expected_execution_version=get_product_batch(database_path, result.batch_id)[
            "execution_version"
        ],
    )

    assert get_product_batch(database_path, result.batch_id)["status"] == "COMPLETED"
    assert product_counts(database_path)["total"] == 18


def _activate_second_rule(database_path: Path) -> None:
    with transaction(database_path) as connection:
        connection.execute(
            "UPDATE title_rule_versions SET status = 'INACTIVE' WHERE status = 'ACTIVE'"
        )
        connection.execute(
            """
            INSERT INTO title_rule_versions (
                rule_version, status, is_provisional, platform_rule_status,
                country_template_a, country_template_b, city_template_a, city_template_b,
                warning_length_units, maximum_length_units, risk_terms_json, notes_zh, created_at
            )
            SELECT
                'PROVISIONAL_V2', 'ACTIVE', 1, platform_rule_status,
                country_template_a || '新版', country_template_b || '新版',
                city_template_a || '新版', city_template_b || '新版',
                warning_length_units, maximum_length_units, risk_terms_json,
                '测试用第二版规则', created_at
            FROM title_rule_versions
            WHERE rule_version = 'PROVISIONAL_V1'
            """
        )


def test_selected_title_is_preserved_and_new_rule_job_is_protected(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    create_product_batch(database_path, scope="ALL", missing_only=False)
    with transaction(database_path) as connection:
        product = connection.execute(
            "SELECT * FROM products WHERE product_code = 'CITY-JP-TOKYO'"
        ).fetchone()
        candidate = connection.execute(
            """
            SELECT * FROM title_candidates
            WHERE product_id = ? AND candidate_code = 'A'
            """,
            (product["id"],),
        ).fetchone()

    select_title_candidate(
        database_path,
        product_id=product["id"],
        candidate_id=candidate["id"],
        expected_version=product["version"],
    )
    _activate_second_rule(database_path)
    second_batch = create_product_batch(database_path, scope="CITIES", missing_only=False)

    with transaction(database_path) as connection:
        protected_product = connection.execute(
            "SELECT * FROM products WHERE id = ?", (product["id"],)
        ).fetchone()
        tokyo_job = connection.execute(
            """
            SELECT * FROM generation_jobs
            WHERE batch_id = ? AND target_code = 'CITY-JP-TOKYO'
            """,
            (second_batch.batch_id,),
        ).fetchone()
        title_count = connection.execute(
            "SELECT COUNT(*) FROM title_candidates WHERE product_id = ?", (product["id"],)
        ).fetchone()[0]
    assert tokyo_job["status"] == "PROTECTED"
    assert tokyo_job["error_code"] == "PRODUCT_CONTENT_PROTECTED"
    assert protected_product["selected_title_id"] == candidate["id"]
    assert protected_product["rule_version"] == "PROVISIONAL_V1"
    assert title_count == 2
    assert get_product_batch(database_path, second_batch.batch_id)["protected_count"] == 1


def test_approved_content_is_never_overwritten_by_new_rule(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    with transaction(database_path) as connection:
        connection.execute(
            """
            UPDATE title_rule_versions
            SET is_provisional = 0, platform_rule_status = 'VERIFIED'
            WHERE status = 'ACTIVE'
            """
        )
    create_product_batch(database_path, scope="ALL", missing_only=False)
    with transaction(database_path) as connection:
        product = connection.execute(
            "SELECT * FROM products WHERE product_code = 'CITY-JP-TOKYO'"
        ).fetchone()
        candidate_id = connection.execute(
            "SELECT id FROM title_candidates WHERE product_id = ? AND candidate_code = 'A'",
            (product["id"],),
        ).fetchone()[0]
    select_title_candidate(
        database_path,
        product_id=product["id"],
        candidate_id=candidate_id,
        expected_version=product["version"],
    )
    with transaction(database_path) as connection:
        connection.execute(
            "UPDATE product_services SET coverage_status = 'CONFIRMED' WHERE product_id = ?",
            (product["id"],),
        )
        connection.execute(
            """
            UPDATE products
            SET title_review_status = 'CONFIRMED', status = 'APPROVED'
            WHERE id = ?
            """,
            (product["id"],),
        )
    _activate_second_rule(database_path)

    second_batch = create_product_batch(database_path, scope="CITIES", missing_only=False)

    with transaction(database_path) as connection:
        protected_product = connection.execute(
            "SELECT * FROM products WHERE id = ?", (product["id"],)
        ).fetchone()
        protected_job = connection.execute(
            """
            SELECT * FROM generation_jobs
            WHERE batch_id = ? AND target_code = 'CITY-JP-TOKYO'
            """,
            (second_batch.batch_id,),
        ).fetchone()
    assert protected_product["status"] == "APPROVED"
    assert protected_product["selected_title_id"] == candidate_id
    assert protected_product["rule_version"] == "PROVISIONAL_V1"
    assert protected_job["status"] == "PROTECTED"


def test_stale_or_foreign_title_selection_is_rejected(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    create_product_batch(database_path, scope="ALL", missing_only=False)
    with transaction(database_path) as connection:
        products = connection.execute("SELECT * FROM products ORDER BY id LIMIT 2").fetchall()
        first_candidates = connection.execute(
            "SELECT * FROM title_candidates WHERE product_id = ? ORDER BY candidate_code",
            (products[0]["id"],),
        ).fetchall()
        foreign_candidate = connection.execute(
            "SELECT * FROM title_candidates WHERE product_id = ? LIMIT 1", (products[1]["id"],)
        ).fetchone()

    select_title_candidate(
        database_path,
        product_id=products[0]["id"],
        candidate_id=first_candidates[0]["id"],
        expected_version=products[0]["version"],
    )
    with pytest.raises(ProductTaskError) as stale:
        select_title_candidate(
            database_path,
            product_id=products[0]["id"],
            candidate_id=first_candidates[1]["id"],
            expected_version=products[0]["version"],
        )
    assert stale.value.code == "PRODUCT_VERSION_CONFLICT"

    with transaction(database_path) as connection:
        current_version = connection.execute(
            "SELECT version FROM products WHERE id = ?", (products[0]["id"],)
        ).fetchone()[0]
    with pytest.raises(ProductTaskError) as foreign:
        select_title_candidate(
            database_path,
            product_id=products[0]["id"],
            candidate_id=foreign_candidate["id"],
            expected_version=current_version,
        )
    assert foreign.value.code == "TITLE_CANDIDATE_NOT_CURRENT"


def test_database_guards_city_country_and_selected_title_ownership(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    create_product_batch(database_path, scope="ALL", missing_only=False)
    with transaction(database_path) as connection:
        france_id = connection.execute(
            "SELECT id FROM countries WHERE country_code = 'FR'"
        ).fetchone()[0]
        tokyo_id = connection.execute(
            "SELECT id FROM cities WHERE city_code = 'JP-TOKYO'"
        ).fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError, match="CITY_COUNTRY_MISMATCH"):
            connection.execute(
                """
                INSERT INTO products (
                    product_code, product_level, country_id, city_id, status,
                    title_review_status, rule_version, created_at, updated_at
                ) VALUES (
                    'CITY-BAD', 'CITY', ?, ?, 'DRAFT', 'PENDING',
                    'PROVISIONAL_V1', 'now', 'now'
                )
                """,
                (france_id, tokyo_id),
            )

    with transaction(database_path) as connection:
        products = connection.execute("SELECT id FROM products ORDER BY id LIMIT 2").fetchall()
        foreign_title = connection.execute(
            "SELECT id FROM title_candidates WHERE product_id = ? LIMIT 1", (products[1]["id"],)
        ).fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError, match="TITLE_PRODUCT_MISMATCH"):
            connection.execute(
                "UPDATE products SET selected_title_id = ? WHERE id = ?",
                (foreign_title, products[0]["id"]),
            )


def test_database_rejects_illegal_status_and_unverified_approval(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    create_product_batch(database_path, scope="ALL", missing_only=False)

    with transaction(database_path) as connection:
        product_id = connection.execute(
            "SELECT id FROM products WHERE product_code = 'COUNTRY-JP'"
        ).fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError, match="INVALID_PRODUCT_STATUS_TRANSITION"):
            connection.execute(
                "UPDATE products SET status = 'PUBLISHED' WHERE id = ?", (product_id,)
            )
        with pytest.raises(
            sqlite3.IntegrityError,
            match=(
                "(TITLE_NOT_CONFIRMED|SERVICE_COVERAGE_UNVERIFIED|"
                "SERVICE_COVERAGE_NOT_CONFIRMED|TITLE_RULE_UNVERIFIED)"
            ),
        ):
            connection.execute(
                "UPDATE products SET status = 'APPROVED' WHERE id = ?", (product_id,)
            )
