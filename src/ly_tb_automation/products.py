"""Product batch, title generation, recovery, and draft-selection services."""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .database import transaction
from .title_rules import TitleDraft, TitleRule, TitleRuleError, render_title_candidates

LOGGER = logging.getLogger(__name__)

PRODUCT_SCOPES = {"ALL", "COUNTRIES", "CITIES", "CORE_CITIES"}
PROTECTED_PRODUCT_STATUSES = {"APPROVED", "READY_TO_PUBLISH", "PUBLISHED"}


class ProductTaskError(ValueError):
    """Stable, operator-facing error raised by product task services."""

    def __init__(self, code: str, message_zh: str) -> None:
        super().__init__(message_zh)
        self.code = code
        self.message_zh = message_zh


@dataclass(frozen=True, slots=True)
class ProductTarget:
    product_code: str
    product_level: str
    country_id: int
    country_code: str
    country_name_zh: str
    city_id: int | None
    city_code: str | None
    city_name_zh: str | None
    is_core_city: bool
    sort_key: tuple[int, int, int]
    source_updated_at: str

    def snapshot(self) -> dict[str, Any]:
        return {
            "product_code": self.product_code,
            "product_level": self.product_level,
            "country_id": self.country_id,
            "country_code": self.country_code,
            "country_name_zh": self.country_name_zh,
            "city_id": self.city_id,
            "city_code": self.city_code,
            "city_name_zh": self.city_name_zh,
            "is_core_city": self.is_core_city,
            "source_updated_at": self.source_updated_at,
        }


@dataclass(frozen=True, slots=True)
class BatchCreationResult:
    batch_id: int
    batch_code: str
    created: bool


@dataclass(frozen=True, slots=True)
class GenerationOutcome:
    status: str
    product_id: int | None
    output: dict[str, Any]
    reused_from_job_id: int | None = None
    error_code: str | None = None
    error_message: str | None = None


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _fingerprint(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _read_json_object(value: str, error_code: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ProductTaskError(error_code, "任务输入快照损坏，无法继续执行") from exc
    if not isinstance(parsed, dict):
        raise ProductTaskError(error_code, "任务输入快照格式不正确")
    return parsed


def _active_rule(connection: sqlite3.Connection) -> tuple[TitleRule, dict[str, Any]]:
    row = connection.execute(
        """
        SELECT *
        FROM title_rule_versions
        WHERE status = 'ACTIVE'
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()
    if row is None:
        raise ProductTaskError("TITLE_RULE_NOT_FOUND", "没有可用的标题规则版本")
    try:
        risk_terms_raw = json.loads(row["risk_terms_json"])
    except json.JSONDecodeError as exc:
        raise ProductTaskError("TITLE_RULE_INVALID", "标题规则中的风险词配置损坏") from exc
    if not isinstance(risk_terms_raw, list) or not all(
        isinstance(item, str) for item in risk_terms_raw
    ):
        raise ProductTaskError("TITLE_RULE_INVALID", "标题规则中的风险词配置格式不正确")
    risk_terms = tuple(risk_terms_raw)
    rule = TitleRule(
        version=row["rule_version"],
        country_template_a=row["country_template_a"],
        country_template_b=row["country_template_b"],
        city_template_a=row["city_template_a"],
        city_template_b=row["city_template_b"],
        warning_length_units=row["warning_length_units"],
        maximum_length_units=row["maximum_length_units"],
        risk_terms=risk_terms,
        is_provisional=bool(row["is_provisional"]),
        platform_rule_status=row["platform_rule_status"],
    )
    snapshot = {
        "version": rule.version,
        "country_template_a": rule.country_template_a,
        "country_template_b": rule.country_template_b,
        "city_template_a": rule.city_template_a,
        "city_template_b": rule.city_template_b,
        "warning_length_units": rule.warning_length_units,
        "maximum_length_units": rule.maximum_length_units,
        "risk_terms": list(rule.risk_terms),
        "is_provisional": rule.is_provisional,
        "platform_rule_status": rule.platform_rule_status,
    }
    return rule, snapshot


def _rule_from_snapshot(snapshot: dict[str, Any]) -> TitleRule:
    try:
        risk_terms_value = snapshot["risk_terms"]
        if not isinstance(risk_terms_value, list) or not all(
            isinstance(item, str) for item in risk_terms_value
        ):
            raise TypeError
        return TitleRule(
            version=str(snapshot["version"]),
            country_template_a=str(snapshot["country_template_a"]),
            country_template_b=str(snapshot["country_template_b"]),
            city_template_a=str(snapshot["city_template_a"]),
            city_template_b=str(snapshot["city_template_b"]),
            warning_length_units=int(snapshot["warning_length_units"]),
            maximum_length_units=int(snapshot["maximum_length_units"]),
            risk_terms=tuple(risk_terms_value),
            is_provisional=bool(snapshot["is_provisional"]),
            platform_rule_status=str(snapshot["platform_rule_status"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ProductTaskError("TITLE_RULE_SNAPSHOT_INVALID", "任务中的标题规则快照损坏") from exc


def _service_snapshot(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, service_code, name_zh, sort_order
        FROM service_types
        WHERE is_enabled = 1
        ORDER BY sort_order, service_code
        """
    ).fetchall()
    if not rows:
        raise ProductTaskError("SERVICE_TYPES_NOT_FOUND", "没有启用的服务类型")
    return [
        {
            "id": row["id"],
            "service_code": row["service_code"],
            "name_zh": row["name_zh"],
            "sort_order": row["sort_order"],
            "coverage_status": "UNVERIFIED",
        }
        for row in rows
    ]


def _product_targets(
    connection: sqlite3.Connection, scope: str, missing_only: bool
) -> list[ProductTarget]:
    if scope not in PRODUCT_SCOPES:
        raise ProductTaskError("INVALID_PRODUCT_SCOPE", "商品批次范围不正确")

    targets: list[ProductTarget] = []
    if scope in {"ALL", "COUNTRIES"}:
        countries = connection.execute(
            """
            SELECT id, country_code, name_zh, priority, updated_at
            FROM countries
            WHERE is_enabled = 1
            ORDER BY priority, country_code
            """
        ).fetchall()
        targets.extend(
            ProductTarget(
                product_code=f"COUNTRY-{row['country_code']}",
                product_level="COUNTRY",
                country_id=row["id"],
                country_code=row["country_code"],
                country_name_zh=row["name_zh"],
                city_id=None,
                city_code=None,
                city_name_zh=None,
                is_core_city=False,
                sort_key=(row["priority"], 0, 0),
                source_updated_at=row["updated_at"],
            )
            for row in countries
        )

    if scope in {"ALL", "CITIES", "CORE_CITIES"}:
        core_filter = "AND cities.is_core_city = 1" if scope == "CORE_CITIES" else ""
        cities = connection.execute(
            f"""
            SELECT
                countries.id AS country_id,
                countries.country_code,
                countries.name_zh AS country_name_zh,
                countries.priority AS country_priority,
                countries.updated_at AS country_updated_at,
                cities.id AS city_id,
                cities.city_code,
                cities.name_zh AS city_name_zh,
                cities.is_core_city,
                cities.priority AS city_priority,
                cities.updated_at AS city_updated_at
            FROM cities
            JOIN countries ON countries.id = cities.country_id
            WHERE countries.is_enabled = 1 AND cities.is_enabled = 1
            {core_filter}
            ORDER BY countries.priority, cities.priority, cities.city_code
            """
        ).fetchall()
        targets.extend(
            ProductTarget(
                product_code=f"CITY-{row['city_code']}",
                product_level="CITY",
                country_id=row["country_id"],
                country_code=row["country_code"],
                country_name_zh=row["country_name_zh"],
                city_id=row["city_id"],
                city_code=row["city_code"],
                city_name_zh=row["city_name_zh"],
                is_core_city=bool(row["is_core_city"]),
                sort_key=(row["country_priority"], 1, row["city_priority"]),
                source_updated_at=max(row["country_updated_at"], row["city_updated_at"]),
            )
            for row in cities
        )

    if missing_only and targets:
        placeholders = ",".join("?" for _ in targets)
        existing_codes = {
            row["product_code"]
            for row in connection.execute(
                f"SELECT product_code FROM products WHERE product_code IN ({placeholders})",
                [target.product_code for target in targets],
            )
        }
        targets = [target for target in targets if target.product_code not in existing_codes]
    return sorted(targets, key=lambda target: target.sort_key)


def create_product_batch(
    database_path: Path, *, scope: str = "ALL", missing_only: bool = True
) -> BatchCreationResult:
    """Create an idempotent batch and synchronously process its independent jobs."""

    with transaction(database_path) as connection:
        _, rule_snapshot = _active_rule(connection)
        services = _service_snapshot(connection)
        targets = _product_targets(connection, scope, missing_only)
    if not targets:
        raise ProductTaskError("NO_PRODUCT_TARGETS", "当前范围没有需要创建的商品")

    target_snapshots = [target.snapshot() for target in targets]
    batch_snapshot = {
        "schema_version": 1,
        "scope": scope,
        "missing_only": missing_only,
        "rule": rule_snapshot,
        "services": services,
        "targets": target_snapshots,
    }
    input_hash = _fingerprint(batch_snapshot)
    batch_code = f"BATCH-{input_hash[:12].upper()}"
    timestamp = _timestamp()

    with transaction(database_path) as connection:
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO product_batches (
                batch_code, scope, missing_only, status, input_hash, input_snapshot,
                target_count, created_at
            ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)
            """,
            (
                batch_code,
                scope,
                int(missing_only),
                input_hash,
                _canonical_json(batch_snapshot),
                len(targets),
                timestamp,
            ),
        )
        batch = connection.execute(
            "SELECT id, batch_code FROM product_batches WHERE input_hash = ?", (input_hash,)
        ).fetchone()
        if batch is None:
            raise ProductTaskError("BATCH_CREATE_FAILED", "商品批次创建失败")
        batch_id = batch["id"]
        if cursor.rowcount != 1:
            return BatchCreationResult(batch_id, batch["batch_code"], False)
        for target_snapshot in target_snapshots:
            job_snapshot = {
                "schema_version": 1,
                "target": target_snapshot,
                "rule": rule_snapshot,
                "services": services,
            }
            connection.execute(
                """
                INSERT INTO generation_jobs (
                    batch_id, target_code, status, input_hash, input_snapshot, created_at
                ) VALUES (?, ?, 'PENDING', ?, ?, ?)
                """,
                (
                    batch_id,
                    target_snapshot["product_code"],
                    _fingerprint(job_snapshot),
                    _canonical_json(job_snapshot),
                    timestamp,
                ),
            )
        connection.execute(
            """
            INSERT INTO product_events(batch_id, event_type, details_json, created_at)
            VALUES (?, 'BATCH_CREATED', ?, ?)
            """,
            (
                batch_id,
                _canonical_json(
                    {
                        "scope": scope,
                        "missing_only": missing_only,
                        "target_count": len(targets),
                        "actor_type": "LOCAL_UNAUTHENTICATED",
                    }
                ),
                timestamp,
            ),
        )

    run_product_batch(database_path, batch_id, expected_execution_version=0)
    return BatchCreationResult(batch_id, batch_code, True)


def _title_issue_snapshot(draft: TitleDraft) -> list[dict[str, str]]:
    return [{"code": issue.code, "message_zh": issue.message_zh} for issue in draft.issues]


def _insert_or_verify_candidate(
    connection: sqlite3.Connection,
    *,
    product_id: int,
    job_id: int,
    input_hash: str,
    rule_version: str,
    draft: TitleDraft,
    timestamp: str,
) -> None:
    issue_json = _canonical_json(_title_issue_snapshot(draft))
    existing = connection.execute(
        """
        SELECT title, length_units, validation_status, validation_errors_json
        FROM title_candidates
        WHERE generation_job_id = ? AND candidate_code = ?
        """,
        (job_id, draft.candidate_code),
    ).fetchone()
    expected = (draft.title, draft.length_units, draft.validation_status, issue_json)
    if existing is not None:
        actual = (
            existing["title"],
            existing["length_units"],
            existing["validation_status"],
            existing["validation_errors_json"],
        )
        if actual != expected:
            raise ProductTaskError(
                "NON_DETERMINISTIC_TITLE_OUTPUT", "同一任务重跑产生了不同标题，已停止覆盖"
            )
        return
    connection.execute(
        """
        INSERT INTO title_candidates (
            product_id, generation_job_id, candidate_code, title, generation_method,
            rule_version, input_hash, length_units, validation_status,
            validation_errors_json, created_at
        ) VALUES (?, ?, ?, ?, 'RULE', ?, ?, ?, ?, ?, ?)
        """,
        (
            product_id,
            job_id,
            draft.candidate_code,
            draft.title,
            rule_version,
            input_hash,
            draft.length_units,
            draft.validation_status,
            issue_json,
            timestamp,
        ),
    )


def _generate_product(connection: sqlite3.Connection, job: sqlite3.Row) -> GenerationOutcome:
    snapshot = _read_json_object(job["input_snapshot"], "JOB_SNAPSHOT_INVALID")
    try:
        target = snapshot["target"]
        rule_snapshot = snapshot["rule"]
        services = snapshot["services"]
        if not isinstance(target, dict) or not isinstance(rule_snapshot, dict):
            raise TypeError
        if not isinstance(services, list) or not all(isinstance(item, dict) for item in services):
            raise TypeError
        product_code = str(target["product_code"])
        product_level = str(target["product_level"])
        country_id = int(target["country_id"])
        country_name_zh = str(target["country_name_zh"])
        city_id_value = target.get("city_id")
        city_id = int(city_id_value) if city_id_value is not None else None
        city_name_value = target.get("city_name_zh")
        city_name_zh = str(city_name_value) if city_name_value is not None else None
    except (KeyError, TypeError, ValueError) as exc:
        raise ProductTaskError("JOB_TARGET_INVALID", "任务中的目的地快照损坏") from exc

    rule = _rule_from_snapshot(rule_snapshot)
    product = connection.execute(
        """
        SELECT products.*, generation_jobs.status AS current_job_status
        FROM products
        LEFT JOIN generation_jobs ON generation_jobs.id = products.current_title_job_id
        WHERE products.product_code = ?
        """,
        (product_code,),
    ).fetchone()
    if (
        product is not None
        and product["current_input_hash"] == job["input_hash"]
        and product["current_title_job_id"] is not None
        and product["current_job_status"] in {"SUCCEEDED", "REUSED"}
    ):
        return GenerationOutcome(
            "REUSED",
            product["id"],
            {
                "product_code": product_code,
                "reused": True,
                "current_title_job_id": product["current_title_job_id"],
            },
            reused_from_job_id=product["current_title_job_id"],
        )
    if (
        product is not None
        and product["current_title_job_id"] is not None
        and product["current_title_job_id"] > job["id"]
    ):
        return GenerationOutcome(
            "PROTECTED",
            product["id"],
            {
                "product_code": product_code,
                "protected": True,
                "current_title_job_id": product["current_title_job_id"],
                "stale_job_id": job["id"],
            },
            error_code="STALE_GENERATION_JOB",
            error_message="该任务早于商品当前标题版本，恢复时未覆盖较新结果",
        )
    if product is not None and (
        product["status"] in PROTECTED_PRODUCT_STATUSES
        or product["selected_title_id"] is not None
        or product["title_review_status"] == "CONFIRMED"
    ):
        return GenerationOutcome(
            "PROTECTED",
            product["id"],
            {
                "product_code": product_code,
                "protected": True,
                "selected_title_id": product["selected_title_id"],
            },
            error_code="PRODUCT_CONTENT_PROTECTED",
            error_message="商品已有人工选择或批准内容，普通重跑未覆盖",
        )

    timestamp = _timestamp()
    if product is None:
        cursor = connection.execute(
            """
            INSERT INTO products (
                product_code, product_theme, product_level, country_id, city_id,
                status, title_review_status, rule_version, version, created_at, updated_at
            ) VALUES (?, 'GENERAL', ?, ?, ?, 'GENERATING', 'PENDING', ?, 1, ?, ?)
            """,
            (
                product_code,
                product_level,
                country_id,
                city_id,
                rule.version,
                timestamp,
                timestamp,
            ),
        )
        product_id = cursor.lastrowid
        if product_id is None:
            raise ProductTaskError("PRODUCT_CREATE_FAILED", "商品创建失败")
    else:
        product_id = product["id"]
        connection.execute(
            """
            UPDATE products
            SET status = 'GENERATING', rule_version = ?, version = version + 1, updated_at = ?
            WHERE id = ?
            """,
            (rule.version, timestamp, product_id),
        )

    connection.execute(
        "UPDATE generation_jobs SET product_id = ? WHERE id = ?",
        (product_id, job["id"]),
    )

    for service in services:
        try:
            service_id = int(service["id"])
            sort_order = int(service["sort_order"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ProductTaskError("SERVICE_SNAPSHOT_INVALID", "任务中的服务快照损坏") from exc
        connection.execute(
            """
            INSERT INTO product_services (
                product_id, service_type_id, sort_order, coverage_status, created_at
            ) VALUES (?, ?, ?, 'UNVERIFIED', ?)
            ON CONFLICT(product_id, service_type_id) DO UPDATE SET
                sort_order = excluded.sort_order
            """,
            (product_id, service_id, sort_order, timestamp),
        )

    drafts = render_title_candidates(
        product_level=product_level,
        country_name_zh=country_name_zh,
        city_name_zh=city_name_zh,
        rule=rule,
    )
    for draft in drafts:
        _insert_or_verify_candidate(
            connection,
            product_id=product_id,
            job_id=job["id"],
            input_hash=job["input_hash"],
            rule_version=rule.version,
            draft=draft,
            timestamp=timestamp,
        )

    has_invalid = any(draft.validation_status == "INVALID" for draft in drafts)
    product_status = "VALIDATION_FAILED" if has_invalid else "WAITING_REVIEW"
    connection.execute(
        """
        UPDATE products
        SET status = ?, title_review_status = 'PENDING', current_input_hash = ?,
            current_title_job_id = ?, rule_version = ?, updated_at = ?
        WHERE id = ?
        """,
        (product_status, job["input_hash"], job["id"], rule.version, timestamp, product_id),
    )
    output = {
        "product_code": product_code,
        "product_status": product_status,
        "rule_version": rule.version,
        "service_coverage_status": "UNVERIFIED",
        "titles": [
            {
                "candidate_code": draft.candidate_code,
                "title": draft.title,
                "length_units": draft.length_units,
                "validation_status": draft.validation_status,
                "issues": _title_issue_snapshot(draft),
            }
            for draft in drafts
        ],
    }
    if has_invalid:
        return GenerationOutcome(
            "FAILED",
            product_id,
            output,
            error_code="TITLE_VALIDATION_FAILED",
            error_message="候选标题未通过内部草稿校验",
        )
    return GenerationOutcome("SUCCEEDED", product_id, output)


def _record_job_failure(
    connection: sqlite3.Connection, job: sqlite3.Row, code: str, message: str
) -> None:
    timestamp = _timestamp()
    connection.execute(
        """
        UPDATE generation_jobs
        SET status = 'FAILED', error_code = ?, error_message = ?, finished_at = ?
        WHERE id = ?
        """,
        (code, message, timestamp, job["id"]),
    )
    connection.execute(
        """
        INSERT INTO product_events(
            batch_id, generation_job_id, event_type, details_json, created_at
        )
        VALUES (?, ?, 'TITLE_GENERATION_FAILED', ?, ?)
        """,
        (
            job["batch_id"],
            job["id"],
            _canonical_json({"error_code": code, "message_zh": message}),
            timestamp,
        ),
    )


def _run_generation_job(
    database_path: Path,
    job_id: int,
    *,
    retry_failed: bool,
    expected_attempt_count: int,
) -> None:
    allowed_statuses = ("PENDING", "RUNNING", "FAILED") if retry_failed else ("PENDING", "RUNNING")
    placeholders = ",".join("?" for _ in allowed_statuses)
    with transaction(database_path) as connection:
        timestamp = _timestamp()
        cursor = connection.execute(
            f"""
            UPDATE generation_jobs
            SET status = 'RUNNING', attempt_count = attempt_count + 1,
                error_code = NULL, error_message = NULL, started_at = ?, finished_at = NULL
            WHERE id = ? AND attempt_count = ? AND status IN ({placeholders})
            """,
            (timestamp, job_id, expected_attempt_count, *allowed_statuses),
        )
        if cursor.rowcount != 1:
            return
        job = connection.execute("SELECT * FROM generation_jobs WHERE id = ?", (job_id,)).fetchone()
        if job is None:
            raise ProductTaskError("GENERATION_JOB_NOT_FOUND", "商品生成任务不存在")
        connection.execute("SAVEPOINT generation_unit")
        try:
            outcome = _generate_product(connection, job)
        except (ProductTaskError, TitleRuleError) as exc:
            connection.execute("ROLLBACK TO SAVEPOINT generation_unit")
            connection.execute("RELEASE SAVEPOINT generation_unit")
            code = exc.code
            message = exc.message_zh
            _record_job_failure(connection, job, code, message)
            return
        except Exception:
            connection.execute("ROLLBACK TO SAVEPOINT generation_unit")
            connection.execute("RELEASE SAVEPOINT generation_unit")
            LOGGER.exception("Unexpected title generation failure", extra={"job_id": job_id})
            _record_job_failure(
                connection,
                job,
                "UNEXPECTED_GENERATION_ERROR",
                "生成任务发生未预期错误，请查看本机日志",
            )
            return
        connection.execute("RELEASE SAVEPOINT generation_unit")
        finished_at = _timestamp()
        connection.execute(
            """
            UPDATE generation_jobs
            SET product_id = ?, status = ?, output_snapshot = ?, reused_from_job_id = ?,
                error_code = ?, error_message = ?, finished_at = ?
            WHERE id = ?
            """,
            (
                outcome.product_id,
                outcome.status,
                _canonical_json(outcome.output),
                outcome.reused_from_job_id,
                outcome.error_code,
                outcome.error_message,
                finished_at,
                job_id,
            ),
        )
        event_type = {
            "SUCCEEDED": "TITLE_GENERATED",
            "REUSED": "TITLE_GENERATION_REUSED",
            "PROTECTED": "TITLE_GENERATION_PROTECTED",
            "FAILED": "TITLE_VALIDATION_FAILED",
        }[outcome.status]
        connection.execute(
            """
            INSERT INTO product_events (
                product_id, batch_id, generation_job_id, event_type, details_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                outcome.product_id,
                job["batch_id"],
                job_id,
                event_type,
                _canonical_json(outcome.output),
                finished_at,
            ),
        )


def _refresh_batch(connection: sqlite3.Connection, batch_id: int) -> None:
    rows = connection.execute(
        "SELECT status FROM generation_jobs WHERE batch_id = ?", (batch_id,)
    ).fetchall()
    if not rows:
        raise ProductTaskError("EMPTY_PRODUCT_BATCH", "商品批次不包含任务")
    statuses = [row["status"] for row in rows]
    succeeded = statuses.count("SUCCEEDED")
    reused = statuses.count("REUSED")
    protected = statuses.count("PROTECTED")
    failed = statuses.count("FAILED")
    active = statuses.count("PENDING") + statuses.count("RUNNING")
    if active:
        batch_status = "RUNNING"
        finished_at = None
    elif failed == 0:
        batch_status = "COMPLETED"
        finished_at = _timestamp()
    elif failed == len(statuses):
        batch_status = "FAILED"
        finished_at = _timestamp()
    else:
        batch_status = "PARTIAL_FAILED"
        finished_at = _timestamp()
    connection.execute(
        """
        UPDATE product_batches
        SET status = ?, succeeded_count = ?, reused_count = ?, protected_count = ?,
            failed_count = ?, finished_at = ?
        WHERE id = ?
        """,
        (batch_status, succeeded, reused, protected, failed, finished_at, batch_id),
    )


def run_product_batch(
    database_path: Path,
    batch_id: int,
    *,
    expected_execution_version: int,
    retry_failed: bool = False,
) -> None:
    """Run pending/interrupted jobs and optionally retry failed jobs once."""

    with transaction(database_path) as connection:
        batch = connection.execute(
            "SELECT id, execution_version FROM product_batches WHERE id = ?", (batch_id,)
        ).fetchone()
        if batch is None:
            raise ProductTaskError("PRODUCT_BATCH_NOT_FOUND", "商品批次不存在")
        if batch["execution_version"] != expected_execution_version:
            raise ProductTaskError(
                "BATCH_VERSION_CONFLICT", "批次已被执行或重试，请刷新页面查看最新结果"
            )
        cursor = connection.execute(
            """
            UPDATE product_batches
            SET status = 'RUNNING', execution_version = execution_version + 1,
                started_at = COALESCE(started_at, ?), finished_at = NULL
            WHERE id = ? AND execution_version = ?
            """,
            (_timestamp(), batch_id, expected_execution_version),
        )
        if cursor.rowcount != 1:
            raise ProductTaskError(
                "BATCH_VERSION_CONFLICT", "批次已被执行或重试，请刷新页面查看最新结果"
            )
        statuses = ("PENDING", "RUNNING", "FAILED") if retry_failed else ("PENDING", "RUNNING")
        placeholders = ",".join("?" for _ in statuses)
        jobs = [
            (row["id"], row["attempt_count"])
            for row in connection.execute(
                f"""
                SELECT id, attempt_count FROM generation_jobs
                WHERE batch_id = ? AND status IN ({placeholders})
                ORDER BY id
                """,
                (batch_id, *statuses),
            )
        ]

    for job_id, attempt_count in jobs:
        _run_generation_job(
            database_path,
            job_id,
            retry_failed=retry_failed,
            expected_attempt_count=attempt_count,
        )

    with transaction(database_path) as connection:
        _refresh_batch(connection, batch_id)


def retry_failed_product_jobs(
    database_path: Path, batch_id: int, *, expected_execution_version: int
) -> None:
    run_product_batch(
        database_path,
        batch_id,
        retry_failed=True,
        expected_execution_version=expected_execution_version,
    )


def product_counts(database_path: Path) -> dict[str, int]:
    with transaction(database_path) as connection:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN product_level = 'COUNTRY' THEN 1 ELSE 0 END) AS countries,
                SUM(CASE WHEN product_level = 'CITY' THEN 1 ELSE 0 END) AS cities,
                SUM(CASE WHEN title_review_status = 'SELECTED' THEN 1 ELSE 0 END) AS selected
            FROM products
            """
        ).fetchone()
    return {
        "total": int(row["total"] or 0),
        "countries": int(row["countries"] or 0),
        "cities": int(row["cities"] or 0),
        "selected": int(row["selected"] or 0),
    }


def list_products(database_path: Path) -> list[sqlite3.Row]:
    with transaction(database_path) as connection:
        return list(
            connection.execute(
                """
                SELECT
                    products.*,
                    countries.name_zh AS country_name_zh,
                    countries.country_code,
                    cities.name_zh AS city_name_zh,
                    cities.city_code,
                    title_candidates.title AS selected_title,
                    (
                        SELECT COUNT(*) FROM product_services
                        WHERE product_services.product_id = products.id
                          AND coverage_status = 'UNVERIFIED'
                    ) AS unverified_service_count
                FROM products
                JOIN countries ON countries.id = products.country_id
                LEFT JOIN cities ON cities.id = products.city_id
                LEFT JOIN title_candidates ON title_candidates.id = products.selected_title_id
                ORDER BY countries.priority,
                    CASE products.product_level WHEN 'COUNTRY' THEN 0 ELSE 1 END,
                    cities.priority,
                    products.product_code
                """
            )
        )


def list_product_batches(database_path: Path, limit: int = 20) -> list[sqlite3.Row]:
    with transaction(database_path) as connection:
        return list(
            connection.execute(
                """
                SELECT * FROM product_batches
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )
        )


def get_product_batch(database_path: Path, batch_id: int) -> sqlite3.Row:
    with transaction(database_path) as connection:
        row = connection.execute(
            "SELECT * FROM product_batches WHERE id = ?", (batch_id,)
        ).fetchone()
    if not isinstance(row, sqlite3.Row):
        raise ProductTaskError("PRODUCT_BATCH_NOT_FOUND", "商品批次不存在")
    return row


def list_batch_jobs(database_path: Path, batch_id: int) -> list[sqlite3.Row]:
    with transaction(database_path) as connection:
        return list(
            connection.execute(
                """
                SELECT generation_jobs.*, products.product_code AS stored_product_code
                FROM generation_jobs
                LEFT JOIN products ON products.id = generation_jobs.product_id
                WHERE generation_jobs.batch_id = ?
                ORDER BY generation_jobs.id
                """,
                (batch_id,),
            )
        )


def get_product(database_path: Path, product_id: int) -> sqlite3.Row:
    with transaction(database_path) as connection:
        row = connection.execute(
            """
            SELECT
                products.*,
                countries.name_zh AS country_name_zh,
                countries.country_code,
                cities.name_zh AS city_name_zh,
                cities.city_code,
                selected.title AS selected_title
            FROM products
            JOIN countries ON countries.id = products.country_id
            LEFT JOIN cities ON cities.id = products.city_id
            LEFT JOIN title_candidates AS selected ON selected.id = products.selected_title_id
            WHERE products.id = ?
            """,
            (product_id,),
        ).fetchone()
    if not isinstance(row, sqlite3.Row):
        raise ProductTaskError("PRODUCT_NOT_FOUND", "商品不存在")
    return row


def list_product_titles(database_path: Path, product_id: int) -> list[dict[str, Any]]:
    with transaction(database_path) as connection:
        rows = list(
            connection.execute(
                """
                SELECT title_candidates.*, generation_jobs.status AS job_status
                FROM title_candidates
                JOIN generation_jobs ON generation_jobs.id = title_candidates.generation_job_id
                WHERE title_candidates.product_id = ?
                ORDER BY generation_jobs.id DESC, title_candidates.candidate_code
                """,
                (product_id,),
            )
        )
    results: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            issues = json.loads(row["validation_errors_json"])
        except json.JSONDecodeError:
            issues = [
                {
                    "code": "VALIDATION_DETAILS_CORRUPT",
                    "message_zh": "标题校验详情损坏，请检查数据库",
                }
            ]
        item["validation_issues"] = issues if isinstance(issues, list) else []
        results.append(item)
    return results


def list_product_services(database_path: Path, product_id: int) -> list[sqlite3.Row]:
    with transaction(database_path) as connection:
        return list(
            connection.execute(
                """
                SELECT service_types.service_code, service_types.name_zh,
                    product_services.sort_order, product_services.coverage_status
                FROM product_services
                JOIN service_types ON service_types.id = product_services.service_type_id
                WHERE product_services.product_id = ?
                ORDER BY product_services.sort_order, service_types.service_code
                """,
                (product_id,),
            )
        )


def select_title_candidate(
    database_path: Path,
    *,
    product_id: int,
    candidate_id: int,
    expected_version: int,
) -> None:
    """Select a draft title with optimistic locking; this is not product approval."""

    with transaction(database_path) as connection:
        product = connection.execute(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if product is None:
            raise ProductTaskError("PRODUCT_NOT_FOUND", "商品不存在")
        if product["version"] != expected_version:
            raise ProductTaskError(
                "PRODUCT_VERSION_CONFLICT", "商品已被另一操作更新，请刷新页面后重新选择"
            )
        if product["status"] in PROTECTED_PRODUCT_STATUSES:
            raise ProductTaskError("PRODUCT_CONTENT_PROTECTED", "已批准或已发布商品不能普通改标题")
        if product["status"] != "WAITING_REVIEW":
            raise ProductTaskError(
                "PRODUCT_NOT_READY_FOR_TITLE_SELECTION", "商品标题任务尚未成功，不能选择候选标题"
            )
        candidate = connection.execute(
            """
            SELECT title_candidates.*, generation_jobs.status AS job_status
            FROM title_candidates
            JOIN generation_jobs ON generation_jobs.id = title_candidates.generation_job_id
            WHERE title_candidates.id = ?
              AND title_candidates.product_id = ?
              AND title_candidates.generation_job_id = ?
            """,
            (candidate_id, product_id, product["current_title_job_id"]),
        ).fetchone()
        if candidate is None:
            raise ProductTaskError("TITLE_CANDIDATE_NOT_CURRENT", "只能选择当前商品版本的标题")
        if candidate["job_status"] != "SUCCEEDED":
            raise ProductTaskError("TITLE_JOB_NOT_SUCCESSFUL", "只有成功任务生成的当前标题才能选择")
        if candidate["validation_status"] == "INVALID":
            raise ProductTaskError("TITLE_CANDIDATE_INVALID", "未通过内部校验的标题不能选择")

        timestamp = _timestamp()
        connection.execute(
            "UPDATE title_candidates SET is_selected = 0, selected_at = NULL WHERE product_id = ?",
            (product_id,),
        )
        connection.execute(
            "UPDATE title_candidates SET is_selected = 1, selected_at = ? WHERE id = ?",
            (timestamp, candidate_id),
        )
        cursor = connection.execute(
            """
            UPDATE products
            SET selected_title_id = ?, title_review_status = 'SELECTED',
                version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?
            """,
            (candidate_id, timestamp, product_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise ProductTaskError(
                "PRODUCT_VERSION_CONFLICT", "商品已被另一操作更新，请刷新页面后重新选择"
            )
        connection.execute(
            """
            INSERT INTO product_events(product_id, event_type, details_json, created_at)
            VALUES (?, 'DRAFT_TITLE_SELECTED', ?, ?)
            """,
            (
                product_id,
                _canonical_json(
                    {
                        "candidate_id": candidate_id,
                        "previous_candidate_id": product["selected_title_id"],
                        "actor_type": "LOCAL_UNAUTHENTICATED",
                        "approval_scope": "NONE",
                    }
                ),
                timestamp,
            ),
        )


def clear_title_selection(database_path: Path, *, product_id: int, expected_version: int) -> None:
    """Clear an unconfirmed draft selection without unlocking approved content."""

    with transaction(database_path) as connection:
        product = connection.execute(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if product is None:
            raise ProductTaskError("PRODUCT_NOT_FOUND", "商品不存在")
        if product["version"] != expected_version:
            raise ProductTaskError(
                "PRODUCT_VERSION_CONFLICT", "商品已被另一操作更新，请刷新页面后重试"
            )
        if product["status"] != "WAITING_REVIEW" or product["title_review_status"] != "SELECTED":
            raise ProductTaskError(
                "TITLE_SELECTION_NOT_CLEARABLE", "只有未确认的待审核草稿选择可以撤销"
            )
        timestamp = _timestamp()
        connection.execute(
            "UPDATE title_candidates SET is_selected = 0, selected_at = NULL WHERE product_id = ?",
            (product_id,),
        )
        cursor = connection.execute(
            """
            UPDATE products
            SET selected_title_id = NULL, title_review_status = 'PENDING',
                version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?
            """,
            (timestamp, product_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise ProductTaskError(
                "PRODUCT_VERSION_CONFLICT", "商品已被另一操作更新，请刷新页面后重试"
            )
        connection.execute(
            """
            INSERT INTO product_events(product_id, event_type, details_json, created_at)
            VALUES (?, 'DRAFT_TITLE_SELECTION_CLEARED', ?, ?)
            """,
            (
                product_id,
                _canonical_json(
                    {
                        "previous_candidate_id": product["selected_title_id"],
                        "actor_type": "LOCAL_UNAUTHENTICATED",
                        "approval_scope": "NONE",
                    }
                ),
                timestamp,
            ),
        )
