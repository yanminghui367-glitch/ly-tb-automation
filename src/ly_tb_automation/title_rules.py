"""Deterministic, versioned title rendering for product drafts."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, replace


class TitleRuleError(ValueError):
    """Raised when a stored title rule cannot produce a safe draft."""

    def __init__(self, code: str, message_zh: str) -> None:
        super().__init__(message_zh)
        self.code = code
        self.message_zh = message_zh


@dataclass(frozen=True, slots=True)
class TitleRule:
    version: str
    country_template_a: str
    country_template_b: str
    city_template_a: str
    city_template_b: str
    warning_length_units: int
    maximum_length_units: int
    risk_terms: tuple[str, ...]
    is_provisional: bool
    platform_rule_status: str


@dataclass(frozen=True, slots=True)
class TitleIssue:
    code: str
    message_zh: str


@dataclass(frozen=True, slots=True)
class TitleDraft:
    candidate_code: str
    title: str
    length_units: int
    validation_status: str
    issues: tuple[TitleIssue, ...]


def normalize_title(value: str) -> str:
    """Collapse whitespace without making language-dependent rewrites."""

    return " ".join(value.split()).strip()


def title_length_units(value: str) -> int:
    """Return the project's provisional display budget, not a Taobao rule."""

    return sum(
        2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1 for character in value
    )


def _validate_title(
    candidate_code: str,
    title: str,
    required_names: tuple[str, ...],
    rule: TitleRule,
) -> TitleDraft:
    issues: list[TitleIssue] = []
    if not title:
        issues.append(TitleIssue("TITLE_EMPTY", "标题不能为空"))
    for name in required_names:
        if name and name not in title:
            issues.append(TitleIssue("DESTINATION_NAME_MISSING", f"标题必须包含目的地名称：{name}"))
    for term in rule.risk_terms:
        if term and term in title:
            issues.append(TitleIssue("INTERNAL_RISK_TERM_FOUND", f"标题命中内部风险词：{term}"))

    length_units = title_length_units(title)
    warning_only = False
    if length_units > rule.maximum_length_units:
        warning_only = True
        issues.append(
            TitleIssue(
                "INTERNAL_LENGTH_BUDGET_EXCEEDED",
                f"标题为 {length_units} 个内部计数单位，超过暂定预算 "
                f"{rule.maximum_length_units}；平台规则尚未核验",
            )
        )
    elif length_units >= rule.warning_length_units:
        warning_only = True
        issues.append(
            TitleIssue(
                "INTERNAL_LENGTH_BUDGET_NEAR_LIMIT",
                f"标题为 {length_units} 个内部计数单位，接近暂定预算 {rule.maximum_length_units}",
            )
        )

    blocking_codes = {
        "TITLE_EMPTY",
        "DESTINATION_NAME_MISSING",
        "INTERNAL_RISK_TERM_FOUND",
        "DUPLICATE_CANDIDATES",
    }
    if any(issue.code in blocking_codes for issue in issues):
        status = "INVALID"
    elif warning_only:
        status = "WARNING"
    else:
        status = "VALID"
    return TitleDraft(candidate_code, title, length_units, status, tuple(issues))


def render_title_candidates(
    *,
    product_level: str,
    country_name_zh: str,
    city_name_zh: str | None,
    rule: TitleRule,
) -> tuple[TitleDraft, TitleDraft]:
    """Render title A/B from immutable inputs without AI or randomness."""

    if product_level == "COUNTRY":
        templates = (rule.country_template_a, rule.country_template_b)
        required_names = (country_name_zh,)
    elif product_level == "CITY" and city_name_zh:
        templates = (rule.city_template_a, rule.city_template_b)
        required_names = (city_name_zh,)
    else:
        raise TitleRuleError("INVALID_PRODUCT_TARGET", "城市级商品缺少城市名称")

    context = {"country": country_name_zh, "city": city_name_zh or ""}
    try:
        rendered = tuple(normalize_title(template.format(**context)) for template in templates)
    except (KeyError, ValueError) as exc:
        raise TitleRuleError("TITLE_TEMPLATE_INVALID", "标题模板包含无法识别的变量") from exc

    drafts = (
        _validate_title("A", rendered[0], required_names, rule),
        _validate_title("B", rendered[1], required_names, rule),
    )
    if drafts[0].title == drafts[1].title:
        issue = TitleIssue("DUPLICATE_CANDIDATES", "标题 A 与标题 B 不能相同")
        drafts = (
            replace(drafts[0], validation_status="INVALID", issues=(*drafts[0].issues, issue)),
            replace(drafts[1], validation_status="INVALID", issues=(*drafts[1].issues, issue)),
        )
    return drafts
