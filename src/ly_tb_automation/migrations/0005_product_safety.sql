ALTER TABLE product_batches
ADD COLUMN execution_version INTEGER NOT NULL DEFAULT 0 CHECK (execution_version >= 0);

CREATE TRIGGER trg_products_approval_requires_verified_rule
BEFORE UPDATE OF status ON products
WHEN NEW.status = 'APPROVED' AND NOT EXISTS (
    SELECT 1
    FROM title_candidates
    JOIN title_rule_versions
      ON title_rule_versions.rule_version = title_candidates.rule_version
    WHERE title_candidates.id = NEW.selected_title_id
      AND title_candidates.product_id = NEW.id
      AND title_candidates.generation_job_id = NEW.current_title_job_id
      AND title_candidates.validation_status = 'VALID'
      AND title_candidates.rule_version = NEW.rule_version
      AND title_rule_versions.is_provisional = 0
      AND title_rule_versions.platform_rule_status = 'VERIFIED'
)
BEGIN
    SELECT RAISE(ABORT, 'TITLE_RULE_UNVERIFIED');
END;

CREATE TRIGGER trg_products_approval_requires_all_services_confirmed
BEFORE UPDATE OF status ON products
WHEN NEW.status = 'APPROVED' AND EXISTS (
    SELECT 1 FROM product_services
    WHERE product_services.product_id = NEW.id
      AND product_services.coverage_status <> 'CONFIRMED'
)
BEGIN
    SELECT RAISE(ABORT, 'SERVICE_COVERAGE_NOT_CONFIRMED');
END;

CREATE TRIGGER trg_protected_products_critical_fields_immutable
BEFORE UPDATE OF
    product_code,
    product_theme,
    product_level,
    country_id,
    city_id,
    title_review_status,
    rule_version,
    current_input_hash,
    current_title_job_id,
    selected_title_id
ON products
WHEN OLD.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED') AND (
    OLD.product_code IS NOT NEW.product_code
    OR OLD.product_theme IS NOT NEW.product_theme
    OR OLD.product_level IS NOT NEW.product_level
    OR OLD.country_id IS NOT NEW.country_id
    OR OLD.city_id IS NOT NEW.city_id
    OR OLD.title_review_status IS NOT NEW.title_review_status
    OR OLD.rule_version IS NOT NEW.rule_version
    OR OLD.current_input_hash IS NOT NEW.current_input_hash
    OR OLD.current_title_job_id IS NOT NEW.current_title_job_id
    OR OLD.selected_title_id IS NOT NEW.selected_title_id
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_PRODUCT_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_products_cannot_be_deleted
BEFORE DELETE ON products
WHEN OLD.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_PRODUCT_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_product_services_no_insert
BEFORE INSERT ON product_services
WHEN EXISTS (
    SELECT 1 FROM products
    WHERE products.id = NEW.product_id
      AND products.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_PRODUCT_SERVICES_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_product_services_no_update
BEFORE UPDATE ON product_services
WHEN EXISTS (
    SELECT 1 FROM products
    WHERE products.id = OLD.product_id
      AND products.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_PRODUCT_SERVICES_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_product_services_no_delete
BEFORE DELETE ON product_services
WHEN EXISTS (
    SELECT 1 FROM products
    WHERE products.id = OLD.product_id
      AND products.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_PRODUCT_SERVICES_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_title_candidates_no_insert
BEFORE INSERT ON title_candidates
WHEN EXISTS (
    SELECT 1 FROM products
    WHERE products.id = NEW.product_id
      AND products.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_TITLE_CANDIDATES_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_title_candidates_no_update
BEFORE UPDATE ON title_candidates
WHEN EXISTS (
    SELECT 1 FROM products
    WHERE products.id = OLD.product_id
      AND products.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_TITLE_CANDIDATES_IMMUTABLE');
END;

CREATE TRIGGER trg_protected_title_candidates_no_delete
BEFORE DELETE ON title_candidates
WHEN EXISTS (
    SELECT 1 FROM products
    WHERE products.id = OLD.product_id
      AND products.status IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
)
BEGIN
    SELECT RAISE(ABORT, 'PROTECTED_TITLE_CANDIDATES_IMMUTABLE');
END;

CREATE TRIGGER trg_used_title_rule_semantics_immutable
BEFORE UPDATE OF
    is_provisional,
    platform_rule_status,
    country_template_a,
    country_template_b,
    city_template_a,
    city_template_b,
    warning_length_units,
    maximum_length_units,
    risk_terms_json
ON title_rule_versions
WHEN EXISTS (
    SELECT 1 FROM title_candidates
    WHERE title_candidates.rule_version = OLD.rule_version
)
BEGIN
    SELECT RAISE(ABORT, 'USED_TITLE_RULE_IMMUTABLE');
END;

CREATE TRIGGER trg_used_title_rule_cannot_be_deleted
BEFORE DELETE ON title_rule_versions
WHEN EXISTS (
    SELECT 1 FROM title_candidates
    WHERE title_candidates.rule_version = OLD.rule_version
)
BEGIN
    SELECT RAISE(ABORT, 'USED_TITLE_RULE_IMMUTABLE');
END;
