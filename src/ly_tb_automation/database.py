"""SQLite connection and forward-only migration utilities."""

from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Migration:
    version: str
    sql: str
    checksum: str


def connect(database_path: Path) -> sqlite3.Connection:
    """Open a configured SQLite connection with integrity safeguards."""

    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


@contextmanager
def transaction(database_path: Path) -> Iterator[sqlite3.Connection]:
    connection = connect(database_path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _load_migrations(migrations_dir: Path) -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        migrations.append(Migration(path.stem, sql, checksum))
    return migrations


def migrate(database_path: Path, migrations_dir: Path | None = None) -> list[str]:
    """Apply missing migrations and reject modified applied migrations."""

    directory = migrations_dir or Path(__file__).parent / "migrations"
    applied_now: list[str] = []
    connection = connect(database_path)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )
            """
        )
        applied = {
            row["version"]: row["checksum"]
            for row in connection.execute("SELECT version, checksum FROM schema_migrations")
        }
        for migration in _load_migrations(directory):
            if migration.version in applied:
                if applied[migration.version] != migration.checksum:
                    raise RuntimeError(f"已应用迁移被修改: {migration.version}")
                continue
            version = migration.version.replace("'", "''")
            checksum = migration.checksum.replace("'", "''")
            applied_at = datetime.now(UTC).isoformat().replace("'", "''")
            script = f"""
                BEGIN IMMEDIATE;
                {migration.sql}
                INSERT INTO schema_migrations(version, checksum, applied_at)
                VALUES ('{version}', '{checksum}', '{applied_at}');
                COMMIT;
            """
            try:
                connection.executescript(script)
            except sqlite3.Error:
                connection.rollback()
                raise
            applied_now.append(migration.version)
    finally:
        connection.close()
    return applied_now


def database_health(database_path: Path) -> bool:
    """Return whether SQLite responds and passes a lightweight integrity check."""

    try:
        with transaction(database_path) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
            return result is not None and result[0] == "ok"
    except sqlite3.Error:
        return False
