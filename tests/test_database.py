import sqlite3
from pathlib import Path

import pytest

from ly_tb_automation.database import database_health, migrate, transaction


def test_migration_initializes_database_and_is_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "nested" / "app.db"

    assert migrate(database_path) == [
        "0001_initial",
        "0002_destinations",
        "0003_seed_destinations",
        "0004_product_tasks",
        "0005_product_safety",
    ]
    assert migrate(database_path) == []
    assert database_health(database_path)

    with transaction(database_path) as connection:
        row = connection.execute(
            "SELECT value FROM app_metadata WHERE key = 'schema_status'"
        ).fetchone()
        assert row is not None
        assert row["value"] == "initialized"
        assert connection.execute("SELECT COUNT(*) FROM countries").fetchone()[0] == 3
        assert connection.execute("SELECT COUNT(*) FROM cities").fetchone()[0] == 15
        assert connection.execute("SELECT COUNT(*) FROM service_types").fetchone()[0] == 8
        assert connection.execute("SELECT COUNT(*) FROM title_rule_versions").fetchone()[0] == 1


def test_modified_applied_migration_is_rejected(tmp_path: Path) -> None:
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    migration = migration_dir / "0001_test.sql"
    migration.write_text("CREATE TABLE example (id INTEGER PRIMARY KEY);", encoding="utf-8")
    database_path = tmp_path / "app.db"
    migrate(database_path, migration_dir)

    migration.write_text("CREATE TABLE changed (id INTEGER PRIMARY KEY);", encoding="utf-8")

    with pytest.raises(RuntimeError, match="已应用迁移被修改"):
        migrate(database_path, migration_dir)


def test_failed_migration_rolls_back_and_can_be_retried(tmp_path: Path) -> None:
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    migration = migration_dir / "0001_test.sql"
    migration.write_text(
        "CREATE TABLE example (id INTEGER PRIMARY KEY); INVALID SQL;", encoding="utf-8"
    )
    database_path = tmp_path / "app.db"

    with pytest.raises(sqlite3.Error):
        migrate(database_path, migration_dir)

    migration.write_text("CREATE TABLE example (id INTEGER PRIMARY KEY);", encoding="utf-8")
    assert migrate(database_path, migration_dir) == ["0001_test"]


def test_foreign_keys_are_enforced(tmp_path: Path) -> None:
    database_path = tmp_path / "app.db"
    with transaction(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE parent (id INTEGER PRIMARY KEY);
            CREATE TABLE child (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER NOT NULL REFERENCES parent(id)
            );
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("INSERT INTO child(id, parent_id) VALUES (1, 999)")
