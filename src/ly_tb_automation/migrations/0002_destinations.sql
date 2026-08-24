CREATE TABLE countries (
    id INTEGER PRIMARY KEY,
    country_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name_zh TEXT NOT NULL,
    name_en TEXT NOT NULL,
    region TEXT,
    timezone TEXT,
    priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE cities (
    id INTEGER PRIMARY KEY,
    city_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    name_zh TEXT NOT NULL,
    name_en TEXT NOT NULL,
    slug TEXT NOT NULL COLLATE NOCASE,
    aliases TEXT NOT NULL DEFAULT '[]',
    is_core_city INTEGER NOT NULL DEFAULT 0 CHECK (is_core_city IN (0, 1)),
    priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
    image_status TEXT NOT NULL DEFAULT 'MISSING'
        CHECK (image_status IN ('MISSING', 'PARTIAL', 'READY')),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (country_id, slug)
);

CREATE INDEX idx_cities_country_priority ON cities(country_id, priority, name_zh);

CREATE TABLE service_types (
    id INTEGER PRIMARY KEY,
    service_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name_zh TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE destination_imports (
    id INTEGER PRIMARY KEY,
    source_filename TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    inserted_rows INTEGER NOT NULL,
    updated_rows INTEGER NOT NULL,
    skipped_rows INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE destination_import_errors (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES destination_imports(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    field TEXT NOT NULL,
    error_code TEXT NOT NULL,
    message_zh TEXT NOT NULL,
    raw_value TEXT,
    created_at TEXT NOT NULL
);

INSERT INTO service_types
    (service_code, name_zh, sort_order, is_enabled, created_at, updated_at)
VALUES
    ('LOCAL_COMPANION', '地陪', 10, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('CHINESE_GUIDE', '中文导游', 20, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('TRANSLATION', '翻译服务', 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('AIRPORT_TRANSFER', '接送机', 40, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('CHARTERED_CAR', '包车', 50, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('DAY_TOUR', '一日游', 60, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('BUSINESS_COMPANION', '商务陪同', 70, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('EXHIBITION_SERVICE', '展会服务', 80, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

