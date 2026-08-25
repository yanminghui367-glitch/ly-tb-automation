from ly_tb_automation.title_rules import TitleRule, render_title_candidates, title_length_units


def provisional_rule(**overrides: object) -> TitleRule:
    values: dict[str, object] = {
        "version": "PROVISIONAL_TEST",
        "country_template_a": "{country}旅游地陪中文导游翻译包车接送机定制服务",
        "country_template_b": "{country}当地导游地陪一日游商务陪同展会翻译服务",
        "city_template_a": "{city}中文导游地陪翻译包车接送机一日游商务陪同服务",
        "city_template_b": "{country}{city}旅游地陪中文导游翻译接送机包车定制服务",
        "warning_length_units": 54,
        "maximum_length_units": 60,
        "risk_terms": (),
        "is_provisional": True,
        "platform_rule_status": "UNVERIFIED",
    }
    values.update(overrides)
    return TitleRule(**values)  # type: ignore[arg-type]


def test_country_and_city_titles_are_exact_and_deterministic() -> None:
    rule = provisional_rule()

    country_first = render_title_candidates(
        product_level="COUNTRY", country_name_zh="日本", city_name_zh=None, rule=rule
    )
    country_second = render_title_candidates(
        product_level="COUNTRY", country_name_zh="日本", city_name_zh=None, rule=rule
    )
    city = render_title_candidates(
        product_level="CITY", country_name_zh="日本", city_name_zh="东京", rule=rule
    )

    assert country_first == country_second
    assert [draft.title for draft in country_first] == [
        "日本旅游地陪中文导游翻译包车接送机定制服务",
        "日本当地导游地陪一日游商务陪同展会翻译服务",
    ]
    assert [draft.title for draft in city] == [
        "东京中文导游地陪翻译包车接送机一日游商务陪同服务",
        "日本东京旅游地陪中文导游翻译接送机包车定制服务",
    ]


def test_duplicate_candidates_are_invalid() -> None:
    rule = provisional_rule(country_template_b="{country}旅游地陪中文导游翻译包车接送机定制服务")

    drafts = render_title_candidates(
        product_level="COUNTRY", country_name_zh="日本", city_name_zh=None, rule=rule
    )

    assert {draft.validation_status for draft in drafts} == {"INVALID"}
    assert all("DUPLICATE_CANDIDATES" in {issue.code for issue in draft.issues} for draft in drafts)


def test_internal_risk_term_blocks_selection_candidate() -> None:
    rule = provisional_rule(risk_terms=("包过",), country_template_a="{country}签证包过服务")

    first, _ = render_title_candidates(
        product_level="COUNTRY", country_name_zh="日本", city_name_zh=None, rule=rule
    )

    assert first.validation_status == "INVALID"
    assert "INTERNAL_RISK_TERM_FOUND" in {issue.code for issue in first.issues}


def test_length_budget_is_explicitly_internal_and_non_blocking() -> None:
    rule = provisional_rule(warning_length_units=4, maximum_length_units=6)

    first, _ = render_title_candidates(
        product_level="COUNTRY", country_name_zh="日本", city_name_zh=None, rule=rule
    )

    assert title_length_units("日本A") == 5
    assert first.validation_status == "WARNING"
    assert "INTERNAL_LENGTH_BUDGET_EXCEEDED" in {issue.code for issue in first.issues}
