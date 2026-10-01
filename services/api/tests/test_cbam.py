import pytest

from app.cbam import CbamCalculationInput, calculate_cbam_exposure
from app.reference import ReferenceDataError, get_catalog


def default_input(**updates: object) -> CbamCalculationInput:
    values = {
        "emissions_mode": "default",
        "origin_country": "Türkiye",
        "cn_code": "72163211",
        "import_period": "2026-Q2",
        "shipment_tonnes": 84.6,
    }
    values.update(updates)
    return CbamCalculationInput(**values)  # type: ignore[arg-type]


def test_turkiye_profile_resolves_longest_default_and_route_benchmark() -> None:
    result = calculate_cbam_exposure(default_input())

    assert result["selection"]["matched_default_cn_code"] == "7216"
    assert result["selection"]["matched_benchmark_cn_code"] == "72163211"
    assert result["selection"]["production_route"] == "(C)"
    assert result["embedded_emissions_intensity"] == 2.31
    assert result["benchmark_intensity"] == 1.364


def test_default_exposure_uses_free_allocation_adjustment() -> None:
    result = calculate_cbam_exposure(default_input())

    assert result["cbam_factor"] == 0.975
    assert result["sefa_intensity"] == 1.3299
    assert result["gross_embedded_emissions_tco2e"] == 195.426
    assert result["free_allocation_adjustment_tco2e"] == 112.50954
    assert result["certificates_required"] == 82.91646
    assert result["estimated_cost_eur"] == 6241.95


def test_verified_mode_uses_reported_sefa_without_benchmark_inference() -> None:
    result = calculate_cbam_exposure(
        default_input(
            emissions_mode="verified",
            verified_emissions_intensity=1.74,
            verified_sefa_intensity=1.12,
        )
    )

    assert result["selection"]["benchmark_column"] is None
    assert result["certificates_required"] == 52.452


def test_unpublished_quarter_is_rejected() -> None:
    with pytest.raises(ReferenceDataError, match="No published CBAM certificate price"):
        calculate_cbam_exposure(default_input(import_period="2026-Q3"))


def test_aggregate_cn_code_is_rejected_when_benchmark_is_ambiguous() -> None:
    catalog = get_catalog()

    with pytest.raises(ReferenceDataError, match="ambiguous"):
        catalog.find_default_benchmark("7216", "(C)")
