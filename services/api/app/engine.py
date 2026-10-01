from __future__ import annotations

from datetime import UTC, datetime
from math import ceil, floor
from random import Random
from statistics import mean
from uuid import uuid4

from .cbam import CbamCalculationInput, calculate_cbam_exposure
from .fx import get_fx_assessment, sample_eur_try_change
from .schemas import (
    CbamAssessment,
    CostContribution,
    FxAssessment,
    HistogramBin,
    PercentilePoint,
    ScenarioInput,
    ScenarioResult,
)


def _percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = floor(position)
    upper = ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _histogram(values: list[float], bins: int = 14) -> list[HistogramBin]:
    low = min(values)
    high = max(values)
    width = (high - low) / bins if high > low else 1.0
    counts = [0] * bins

    for value in values:
        index = min(int((value - low) / width), bins - 1)
        counts[index] += 1

    return [
        HistogramBin(
            start_eur=round(low + index * width, 2),
            end_eur=round(low + (index + 1) * width, 2),
            count=count,
        )
        for index, count in enumerate(counts)
    ]


def run_scenario(data: ScenarioInput) -> ScenarioResult:
    cbam_payload = calculate_cbam_exposure(
        CbamCalculationInput(
            emissions_mode=data.emissions_mode,
            origin_country=data.origin_country,
            cn_code=data.cn_code,
            import_period=data.import_period,
            shipment_tonnes=data.shipment_tonnes,
            verified_emissions_intensity=data.verified_emissions_intensity,
            verified_sefa_intensity=data.verified_sefa_intensity,
        )
    )
    cbam = CbamAssessment.model_validate(cbam_payload)
    fx = FxAssessment.model_validate(
        get_fx_assessment(
            data.fx_volatility_mode,
            data.fx_volatility_rate,
            data.delivery_horizon_days,
        )
    )
    random = Random(data.seed)
    margins: list[float] = []
    total_costs: list[float] = []
    cbam_costs: list[float] = []

    for _ in range(data.simulations):
        fx_shock = sample_eur_try_change(
            random.gauss(0, 1), fx.applied_volatility_rate
        )
        input_shock = random.gauss(0, data.input_cost_volatility_rate)
        carbon_shock = random.gauss(0, 0.12)

        exposed_cost = data.production_cost_eur * data.try_cost_exposure_rate
        euro_linked_cost = data.production_cost_eur - exposed_cost
        shocked_local_cost = (
            exposed_cost
            * max(0.55, 1 + input_shock)
            / max(0.4, 1 + fx_shock)
        )
        shocked_euro_cost = euro_linked_cost * max(0.55, 1 + input_shock)
        production_cost = shocked_local_cost + shocked_euro_cost

        certificate_price = cbam.certificate_price_eur * max(0.4, 1 + carbon_shock)
        cbam_cost = cbam.certificates_required * certificate_price
        total_cost = production_cost + cbam_cost
        total_costs.append(total_cost)
        cbam_costs.append(cbam_cost)
        margins.append(data.quote_value_eur - total_cost)

    expected_margin = mean(margins)
    downside_margin = _percentile(margins, 0.10)
    expected_cbam = mean(cbam_costs)
    cost_at_risk = _percentile(total_costs, 0.90)
    safe_floor = cost_at_risk / max(0.01, 1 - data.target_margin_rate)
    recommended_buffer = max(0, safe_floor - data.quote_value_eur)

    percentiles = [
        PercentilePoint(
            percentile=percentile,
            margin_eur=round(value := _percentile(margins, percentile / 100), 2),
            margin_rate=round(value / data.quote_value_eur, 5),
        )
        for percentile in (10, 25, 50, 75, 90)
    ]

    expected_total_cost = mean(total_costs)
    risk_buffer = max(0, cost_at_risk - expected_total_cost)
    contribution_values = [
        ("production", "Üretim maliyeti", data.production_cost_eur),
        ("cbam", "CBAM sertifika etkisi", expected_cbam),
        ("risk_buffer", "Belirsizlik tamponu", risk_buffer),
    ]
    contribution_total = sum(item[2] for item in contribution_values)
    contributions = [
        CostContribution(
            key=key,
            label=label,
            amount_eur=round(amount, 2),
            share_rate=round(amount / contribution_total, 5),
        )
        for key, label, amount in contribution_values
    ]

    return ScenarioResult(
        scenario_id=str(uuid4()),
        generated_at=datetime.now(UTC).isoformat(),
        model_status="decision_support",
        expected_margin_eur=round(expected_margin, 2),
        expected_margin_rate=round(expected_margin / data.quote_value_eur, 5),
        downside_margin_eur=round(downside_margin, 2),
        negative_margin_probability=round(
            sum(margin < 0 for margin in margins) / len(margins), 5
        ),
        cbam_cost_eur=round(expected_cbam, 2),
        safe_floor_price_eur=round(safe_floor, 2),
        recommended_buffer_eur=round(recommended_buffer, 2),
        cbam=cbam,
        fx=fx,
        percentiles=percentiles,
        histogram=_histogram(margins),
        contributions=contributions,
        assumptions=[
            "CBAM tabanı, seçilen dönem için yayımlanmış resmi sertifika fiyatını kullanır.",
            "Resmi varsayılan modunda Türkiye emisyon değeri ve Column B benchmark eşleştirilir.",
            (
                "Kur şoku, TCMB EUR/TRY serisinden kalibre edilen lognormal dağılımla örneklenir."
                if data.fx_volatility_mode == "official"
                else "Kur şoku, kullanıcının manuel oynaklık varsayımıyla lognormal dağılımdan örneklenir."
            ),
            "Girdi maliyeti şokları normal dağılımla örneklenir.",
            "Karbon fiyatı oynaklığı teklif riski için yüzde 12 kabul edilir.",
            "Sonuç karar desteğidir; resmi beyan veya hukuki görüş değildir.",
        ],
    )
