CREATE TABLE title_rule_versions (
    id INTEGER PRIMARY KEY,
    rule_version TEXT NOT NULL UNIQUE COLLATE NOCASE,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    is_provisional INTEGER NOT NULL DEFAULT 1 CHECK (is_provisional IN (0, 1)),
    platform_rule_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (platform_rule_status IN ('UNVERIFIED', 'VERIFIED')),
    country_template_a TEXT NOT NULL,
    country_template_b TEXT NOT NULL,
    city_template_a TEXT NOT NULL,
    city_template_b TEXT NOT NULL,
    warning_length_units INTEGER NOT NULL CHECK (warning_length_units > 0),
    maximum_length_units INTEGER NOT NULL CHECK (
        maximum_length_units >= warning_length_units
    ),
    risk_terms_json TEXT NOT NULL DEFAULT '[]',
    notes_zh TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_title_rule_one_active
ON title_rule_versions(status)
WHERE status = 'ACTIVE';

INSERT INTO title_rule_versions (
    rule_version,
    status,
    is_provisional,
    platform_rule_status,
    country_template_a,
    country_template_b,
    city_template_a,
    city_template_b,
    warning_length_units,
    maximum_length_units,
    risk_terms_json,
    notes_zh,
    created_at
) VALUES (
    'PROVISIONAL_V1',
    'ACTIVE',
    1,
    'UNVERIFIED',
    '{country}旅游地陪中文导游翻译包车接送机定制服务',
    '{country}当地导游地陪一日游商务陪同展会翻译服务',
    '{city}中文导游地陪翻译包车接送机一日游商务陪同服务',
    '{country}{city}旅游地陪中文导游翻译接送机包车定制服务',
    54,
    60,
    '["官方指定","全网最低","百分百保证","包过","零风险"]',
    '内部暂定标题规则，仅用于本地草稿验证；淘宝标题计数、上限和禁用词尚未核验。',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE product_batches (
    id INTEGER PRIMARY KEY,
    batch_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    scope TEXT NOT NULL CHECK (
        scope IN ('ALL', 'COUNTRIES', 'CITIES', 'CORE_CITIES')
    ),
    missing_only INTEGER NOT NULL DEFAULT 1 CHECK (missing_only IN (0, 1)),
    status TEXT NOT NULL CHECK (
        status IN ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED')
    ),
    input_hash TEXT NOT NULL UNIQUE,
    input_snapshot TEXT NOT NULL,
    target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count >= 0),
    succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
    reused_count INTEGER NOT NULL DEFAULT 0 CHECK (reused_count >= 0),
    protected_count INTEGER NOT NULL DEFAULT 0 CHECK (protected_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    product_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    product_theme TEXT NOT NULL DEFAULT 'GENERAL',
    product_level TEXT NOT NULL CHECK (product_level IN ('COUNTRY', 'CITY')),
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    city_id INTEGER REFERENCES cities(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN (
            'DRAFT',
            'GENERATING',
            'GENERATED',
            'WAITING_REVIEW',
            'VALIDATION_FAILED',
            'APPROVED',
            'REJECTED',
            'READY_TO_PUBLISH',
            'PUBLISHED',
            'PUBLISH_FAILED'
        )
    ),
    title_review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        title_review_status IN ('PENDING', 'SELECTED', 'CONFIRMED')
    ),
    rule_version TEXT NOT NULL REFERENCES title_rule_versions(rule_version),
    current_input_hash TEXT,
    current_title_job_id INTEGER REFERENCES generation_jobs(id) ON DELETE RESTRICT,
    selected_title_id INTEGER REFERENCES title_candidates(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
        (product_level = 'COUNTRY' AND city_id IS NULL)
        OR (product_level = 'CITY' AND city_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_products_country_general
ON products(country_id, product_theme)
WHERE product_level = 'COUNTRY';

CREATE UNIQUE INDEX idx_products_city_general
ON products(city_id, product_theme)
WHERE product_level = 'CITY';

CREATE TABLE product_services (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    service_type_id INTEGER NOT NULL REFERENCES service_types(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    coverage_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (
        coverage_status IN ('UNVERIFIED', 'CONFIRMED', 'UNAVAILABLE')
    ),
    created_at TEXT NOT NULL,
    PRIMARY KEY (product_id, service_type_id)
);

CREATE TABLE generation_jobs (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
    target_code TEXT NOT NULL COLLATE NOCASE,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'REUSED', 'PROTECTED', 'FAILED')
    ),
    input_hash TEXT NOT NULL,
    input_snapshot TEXT NOT NULL,
    output_snapshot TEXT,
    reused_from_job_id INTEGER REFERENCES generation_jobs(id) ON DELETE RESTRICT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (batch_id, target_code)
);

CREATE INDEX idx_generation_jobs_batch_status
ON generation_jobs(batch_id, status, target_code);

CREATE INDEX idx_generation_jobs_input
ON generation_jobs(target_code, input_hash, status);

CREATE TABLE title_candidates (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE RESTRICT,
    candidate_code TEXT NOT NULL CHECK (candidate_code IN ('A', 'B', 'MANUAL')),
    title TEXT NOT NULL,
    generation_method TEXT NOT NULL CHECK (generation_method IN ('RULE', 'MANUAL')),
    rule_version TEXT NOT NULL REFERENCES title_rule_versions(rule_version),
    input_hash TEXT NOT NULL,
    length_units INTEGER NOT NULL CHECK (length_units >= 0),
    validation_status TEXT NOT NULL CHECK (
        validation_status IN ('VALID', 'WARNING', 'INVALID')
    ),
    validation_errors_json TEXT NOT NULL DEFAULT '[]',
    is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
    created_at TEXT NOT NULL,
    selected_at TEXT,
    UNIQUE (generation_job_id, candidate_code)
);

CREATE UNIQUE INDEX idx_title_candidates_one_selected
ON title_candidates(product_id)
WHERE is_selected = 1;

CREATE INDEX idx_title_candidates_product_job
ON title_candidates(product_id, generation_job_id, candidate_code);

CREATE TABLE product_events (
    id INTEGER PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    batch_id INTEGER REFERENCES product_batches(id) ON DELETE CASCADE,
    generation_job_id INTEGER REFERENCES generation_jobs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_product_events_product_time
ON product_events(product_id, created_at, id);

CREATE TRIGGER trg_products_city_country_insert
BEFORE INSERT ON products
WHEN NEW.product_level = 'CITY' AND NOT EXISTS (
    SELECT 1 FROM cities
    WHERE cities.id = NEW.city_id AND cities.country_id = NEW.country_id
)
BEGIN
    SELECT RAISE(ABORT, 'CITY_COUNTRY_MISMATCH');
END;

CREATE TRIGGER trg_products_city_country_update
BEFORE UPDATE OF product_level, country_id, city_id ON products
WHEN NEW.product_level = 'CITY' AND NOT EXISTS (
    SELECT 1 FROM cities
    WHERE cities.id = NEW.city_id AND cities.country_id = NEW.country_id
)
BEGIN
    SELECT RAISE(ABORT, 'CITY_COUNTRY_MISMATCH');
END;

CREATE TRIGGER trg_products_selected_title_belongs_to_product
BEFORE UPDATE OF selected_title_id ON products
WHEN NEW.selected_title_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM title_candidates
    WHERE title_candidates.id = NEW.selected_title_id
      AND title_candidates.product_id = NEW.id
)
BEGIN
    SELECT RAISE(ABORT, 'TITLE_PRODUCT_MISMATCH');
END;

CREATE TRIGGER trg_products_current_job_belongs_to_product
BEFORE UPDATE OF current_title_job_id ON products
WHEN NEW.current_title_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM generation_jobs
    WHERE generation_jobs.id = NEW.current_title_job_id
      AND generation_jobs.product_id = NEW.id
)
BEGIN
    SELECT RAISE(ABORT, 'JOB_PRODUCT_MISMATCH');
END;

CREATE TRIGGER trg_products_status_transition
BEFORE UPDATE OF status ON products
WHEN OLD.status <> NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status = 'GENERATING')
    OR (OLD.status = 'GENERATING' AND NEW.status IN (
        'GENERATED', 'VALIDATION_FAILED', 'WAITING_REVIEW'
    ))
    OR (OLD.status = 'GENERATED' AND NEW.status IN (
        'GENERATING', 'VALIDATION_FAILED', 'WAITING_REVIEW'
    ))
    OR (OLD.status = 'VALIDATION_FAILED' AND NEW.status = 'GENERATING')
    OR (OLD.status = 'WAITING_REVIEW' AND NEW.status IN (
        'GENERATING', 'APPROVED', 'REJECTED'
    ))
    OR (OLD.status = 'REJECTED' AND NEW.status IN ('GENERATING', 'WAITING_REVIEW'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'READY_TO_PUBLISH')
    OR (OLD.status = 'READY_TO_PUBLISH' AND NEW.status IN (
        'PUBLISHED', 'PUBLISH_FAILED'
    ))
    OR (OLD.status = 'PUBLISH_FAILED' AND NEW.status = 'READY_TO_PUBLISH')
)
BEGIN
    SELECT RAISE(ABORT, 'INVALID_PRODUCT_STATUS_TRANSITION');
END;

CREATE TRIGGER trg_products_approval_requires_confirmed_title
BEFORE UPDATE OF status ON products
WHEN NEW.status = 'APPROVED' AND (
    NEW.selected_title_id IS NULL OR NEW.title_review_status <> 'CONFIRMED'
)
BEGIN
    SELECT RAISE(ABORT, 'TITLE_NOT_CONFIRMED');
END;

CREATE TRIGGER trg_products_approval_requires_service_confirmation
BEFORE UPDATE OF status ON products
WHEN NEW.status = 'APPROVED' AND EXISTS (
    SELECT 1 FROM product_services
    WHERE product_services.product_id = NEW.id
      AND product_services.coverage_status = 'UNVERIFIED'
)
BEGIN
    SELECT RAISE(ABORT, 'SERVICE_COVERAGE_UNVERIFIED');
END;
