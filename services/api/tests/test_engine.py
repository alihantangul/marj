from app.engine import run_scenario
from app.main import demo_input


def test_scenario_is_deterministic_for_same_seed() -> None:
    data = demo_input()
    first = run_scenario(data)
    second = run_scenario(data)

    assert first.expected_margin_eur == second.expected_margin_eur
    assert first.safe_floor_price_eur == second.safe_floor_price_eur
    assert first.histogram == second.histogram


def test_quote_increase_improves_expected_margin() -> None:
    baseline = demo_input()
    higher_quote = baseline.model_copy(
        update={"quote_value_eur": baseline.quote_value_eur + 10_000}
    )

    baseline_result = run_scenario(baseline)
    higher_result = run_scenario(higher_quote)

    assert higher_result.expected_margin_eur - baseline_result.expected_margin_eur == 10_000
    assert higher_result.negative_margin_probability <= baseline_result.negative_margin_probability


def test_percentiles_are_ordered() -> None:
    result = run_scenario(demo_input())
    margins = [point.margin_eur for point in result.percentiles]

    assert margins == sorted(margins)


def test_scenario_carries_regulatory_trace() -> None:
    result = run_scenario(demo_input())

    assert result.model_status == "decision_support"
    assert result.cbam.catalog_version == "2026-08-10"
    assert result.cbam.selection.benchmark_column == "B"
    assert {step.key for step in result.cbam.trace} == {
        "embedded_emissions",
        "sefa",
        "free_allocation_adjustment",
        "certificates",
        "cbam_cost",
    }
