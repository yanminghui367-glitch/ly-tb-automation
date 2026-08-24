from pathlib import Path
from typing import Any

from ly_tb_automation.database import migrate, transaction
from ly_tb_automation.destinations import (
    destination_counts,
    import_destination_rows,
    list_destinations,
    validate_destination_row,
)


def valid_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "country_code": "TH",
        "country_name_zh": "泰国",
        "country_name_en": "Thailand",
        "city_code": "TH-BANGKOK",
        "city_name_zh": "曼谷",
        "city_name_en": "Bangkok",
        "city_slug": "bangkok",
        "is_core_city": "是",
        "priority": 10,
        "is_enabled": 1,
    }
    row.update(overrides)
    return row


def initialized_database(tmp_path: Path) -> Path:
    database_path = tmp_path / "app.db"
    migrate(database_path)
    return database_path


def test_validation_normalizes_codes_and_booleans() -> None:
    item, errors = validate_destination_row(
        2,
        valid_row(country_code="th", city_code="th-bangkok", city_slug="BANGKOK", is_enabled="否"),
    )

    assert errors == []
    assert item is not None
    assert item.country_code == "TH"
    assert item.city_code == "TH-BANGKOK"
    assert item.city_slug == "bangkok"
    assert item.is_core_city is True
    assert item.is_enabled is False


def test_validation_reports_all_actionable_errors() -> None:
    item, errors = validate_destination_row(
        18,
        valid_row(
            country_code="THA",
            city_code="JP TOKYO",
            city_name_zh="",
            city_slug="bad slug",
            is_core_city="maybe",
            priority="high",
        ),
    )

    assert item is None
    codes = {error.error_code for error in errors}
    assert codes == {
        "REQUIRED_FIELD_MISSING",
        "INVALID_COUNTRY_CODE",
        "INVALID_CITY_CODE",
        "CITY_COUNTRY_MISMATCH",
        "INVALID_CITY_SLUG",
        "INVALID_BOOLEAN",
        "INVALID_PRIORITY",
    }
    assert all(error.row_number == 18 for error in errors)


def test_import_inserts_then_updates_without_duplicates(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)

    first = import_destination_rows(database_path, "first.xlsx", [valid_row()])
    second = import_destination_rows(
        database_path, "second.xlsx", [valid_row(city_name_zh="曼谷市", priority=5)]
    )

    assert (first.inserted_rows, first.updated_rows, first.skipped_rows) == (1, 0, 0)
    assert (second.inserted_rows, second.updated_rows, second.skipped_rows) == (0, 1, 0)
    assert destination_counts(database_path) == (4, 16)
    bangkok = [
        item for item in list_destinations(database_path) if item["city_code"] == "TH-BANGKOK"
    ]
    assert len(bangkok) == 1
    assert bangkok[0]["city_name_zh"] == "曼谷市"
    assert bangkok[0]["priority"] == 5


def test_invalid_and_duplicate_rows_are_skipped_and_audited(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    report = import_destination_rows(
        database_path,
        "mixed.xlsx",
        [valid_row(), valid_row(), valid_row(city_code="TH-PATTAYA", city_name_zh="")],
    )

    assert report.total_rows == 3
    assert report.inserted_rows == 1
    assert report.skipped_rows == 2
    assert {error.error_code for error in report.errors} == {
        "DUPLICATE_CITY_IN_FILE",
        "REQUIRED_FIELD_MISSING",
    }
    with transaction(database_path) as connection:
        stored = connection.execute(
            "SELECT total_rows, skipped_rows, error_count FROM destination_imports WHERE id = ?",
            (report.import_id,),
        ).fetchone()
        assert tuple(stored) == (3, 2, 2)
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM destination_import_errors WHERE import_id = ?",
                (report.import_id,),
            ).fetchone()[0]
            == 2
        )


def test_inconsistent_country_names_in_one_file_are_rejected(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    report = import_destination_rows(
        database_path,
        "countries.xlsx",
        [
            valid_row(),
            valid_row(
                city_code="TH-CHIANG-MAI",
                city_name_zh="清迈",
                city_name_en="Chiang Mai",
                city_slug="chiang-mai",
                country_name_en="Incorrect Thailand",
            ),
        ],
    )

    assert report.inserted_rows == 1
    assert report.skipped_rows == 1
    assert report.errors[0].error_code == "COUNTRY_DATA_CONFLICT"


def test_conflicting_slug_rolls_back_the_entire_row(tmp_path: Path) -> None:
    database_path = initialized_database(tmp_path)
    report = import_destination_rows(
        database_path,
        "conflict.xlsx",
        [
            valid_row(
                country_code="JP",
                country_name_zh="错误国家名",
                country_name_en="Wrong",
                city_code="JP-NEW-TOKYO",
                city_slug="tokyo",
            )
        ],
    )

    assert report.inserted_rows == 0
    assert report.skipped_rows == 1
    assert report.errors[0].error_code == "DESTINATION_CONFLICT"
    with transaction(database_path) as connection:
        country = connection.execute(
            "SELECT name_zh, name_en FROM countries WHERE country_code = 'JP'"
        ).fetchone()
        assert tuple(country) == ("日本", "Japan")
