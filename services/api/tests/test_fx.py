from math import isclose, sqrt

from app.fx import get_fx_assessment, get_fx_catalog, sample_eur_try_change


def test_catalog_uses_versioned_official_observations() -> None:
    catalog = get_fx_catalog()

    assert catalog["publisher"] == "Türkiye Cumhuriyet Merkez Bankası"
    assert catalog["catalog_version"] == "2026-09-30"
    assert catalog["observation_count"] == len(catalog["observations"])
    assert catalog["observation_count"] >= 360
    assert catalog["observations"][-1]["source_url"].startswith(
        "https://www.tcmb.gov.tr/kurlar/"
    )


def test_official_model_scales_volatility_to_delivery_horizon() -> None:
    short = get_fx_assessment("official", 0.5, 30)
    long = get_fx_assessment("official", 0.5, 120)

    expected_ratio = sqrt(long["horizon_business_days"] / short["horizon_business_days"])
    actual_ratio = long["model_volatility_rate"] / short["model_volatility_rate"]
    assert isclose(actual_ratio, expected_ratio, rel_tol=0.01)
    assert short["applied_volatility_rate"] == short["model_volatility_rate"]


def test_calibration_improves_holdout_interval_coverage() -> None:
    backtest = get_fx_assessment("official", 0, 60)["backtest"]

    assert backtest["holdout_count"] >= 50
    assert backtest["calibration_multiplier"] >= 1
    assert (
        backtest["calibrated_coverage_80_rate"]
        > backtest["raw_coverage_80_rate"]
    )
    assert (
        backtest["calibrated_coverage_95_rate"]
        > backtest["raw_coverage_95_rate"]
    )


def test_manual_mode_preserves_user_assumption() -> None:
    assessment = get_fx_assessment("manual", 0.055, 60)

    assert assessment["mode"] == "manual"
    assert assessment["applied_volatility_rate"] == 0.055
    assert assessment["model_volatility_rate"] != 0.055


def test_lognormal_fx_change_never_crosses_minus_one() -> None:
    assert sample_eur_try_change(-20, 0.5) > -1
    assert sample_eur_try_change(2, 0.1) > sample_eur_try_change(-2, 0.1)
