from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ScenarioInput(BaseModel):
    quote_name: str = Field(min_length=2, max_length=80)
    product_name: str = Field(min_length=2, max_length=120)
    destination: str = Field(min_length=2, max_length=80)
    origin_country: str = Field(default="Türkiye", min_length=2, max_length=80)
    cn_code: str = Field(pattern=r"^\d{8}$")
    import_period: str = Field(pattern=r"^20\d{2}-Q[1-4]$")
    emissions_mode: Literal["default", "verified"] = "default"
    quote_value_eur: float = Field(gt=0, le=100_000_000)
    production_cost_eur: float = Field(gt=0, le=100_000_000)
    shipment_tonnes: float = Field(gt=0, le=100_000)
    verified_emissions_intensity: float | None = Field(default=None, gt=0, le=50)
    verified_sefa_intensity: float | None = Field(default=None, ge=0, le=50)
    try_cost_exposure_rate: float = Field(ge=0, le=1)
    fx_volatility_mode: Literal["official", "manual"] = "official"
    fx_volatility_rate: float = Field(ge=0, le=0.5)
    delivery_horizon_days: int = Field(default=60, ge=1, le=365)
    input_cost_volatility_rate: float = Field(ge=0, le=0.5)
    target_margin_rate: float = Field(ge=0, le=0.8)
    simulations: int = Field(default=2_500, ge=500, le=20_000)
    seed: int = Field(default=42, ge=0, le=2_147_483_647)

    @model_validator(mode="after")
    def verified_values_are_complete(self) -> "ScenarioInput":
        if self.emissions_mode == "verified" and (
            self.verified_emissions_intensity is None
            or self.verified_sefa_intensity is None
        ):
            raise ValueError(
                "verified mode requires verified_emissions_intensity and "
                "verified_sefa_intensity"
            )
        return self


class PercentilePoint(BaseModel):
    percentile: Literal[10, 25, 50, 75, 90]
    margin_eur: float
    margin_rate: float


class HistogramBin(BaseModel):
    start_eur: float
    end_eur: float
    count: int


class CostContribution(BaseModel):
    key: Literal["production", "cbam", "risk_buffer"]
    label: str
    amount_eur: float
    share_rate: float


class CbamSelection(BaseModel):
    matched_default_cn_code: str | None
    matched_benchmark_cn_code: str | None
    production_route: str | None
    benchmark_column: str | None
    benchmark_description: str | None


class CalculationTraceStep(BaseModel):
    key: str
    label: str
    formula: str
    expression: str
    unit: str
    source_ids: list[str]


class CbamAssessment(BaseModel):
    method: Literal["default", "verified"]
    catalog_version: str
    origin_country: str
    cn_code: str
    import_period: str
    shipment_tonnes: float
    embedded_emissions_intensity: float
    benchmark_intensity: float | None
    cbam_factor: float
    cscf: float
    cscf_status: Literal["preliminary", "final"]
    sefa_intensity: float
    gross_embedded_emissions_tco2e: float
    free_allocation_adjustment_tco2e: float
    certificates_required: float
    certificate_price_eur: float
    estimated_cost_eur: float
    threshold_signal: Literal["shipment_alone_above", "aggregate_unknown"]
    threshold_note: str
    selection: CbamSelection
    source_ids: list[str]
    warnings: list[str]
    trace: list[CalculationTraceStep]


class FxBacktest(BaseModel):
    forecast_count: int
    calibration_count: int
    holdout_count: int
    lookback_business_days: int
    horizon_business_days: int
    calibration_multiplier: float
    raw_coverage_80_rate: float
    raw_coverage_95_rate: float
    calibrated_coverage_80_rate: float
    calibrated_coverage_95_rate: float
    mean_absolute_actual_return_rate: float
    mean_raw_forecast_volatility_rate: float


class FxAssessment(BaseModel):
    mode: Literal["official", "manual"]
    source_id: str
    source_title: str
    source_url: str
    catalog_version: str
    latest_observation_date: str
    latest_eur_try_mid: float
    observation_count: int
    delivery_horizon_days: int
    horizon_business_days: int
    ewma_decay: float
    daily_volatility_rate: float
    annualized_volatility_rate: float
    raw_horizon_volatility_rate: float
    calibration_multiplier: float
    model_volatility_rate: float
    applied_volatility_rate: float
    recent_20_business_day_change_rate: float
    backtest: FxBacktest


class ScenarioResult(BaseModel):
    scenario_id: str
    generated_at: str
    model_status: Literal["decision_support"]
    expected_margin_eur: float
    expected_margin_rate: float
    downside_margin_eur: float
    negative_margin_probability: float
    cbam_cost_eur: float
    safe_floor_price_eur: float
    recommended_buffer_eur: float
    cbam: CbamAssessment
    fx: FxAssessment
    percentiles: list[PercentilePoint]
    histogram: list[HistogramBin]
    contributions: list[CostContribution]
    assumptions: list[str]


class DemoScenario(BaseModel):
    input: ScenarioInput
    result: ScenarioResult


class ReferenceSource(BaseModel):
    id: str
    title: str
    publisher: str
    published_on: str
    legal_basis: str
    url: str
    binding: bool
    sha256: str | None = None


class ReferenceStatus(BaseModel):
    mode: Literal["official_snapshot"]
    catalog_version: str
    latest_certificate_period: str
    latest_certificate_price_eur: float
    default_value_count: int
    benchmark_count: int
    sources: list[ReferenceSource]
    notes: list[str]


class CnCandidate(BaseModel):
    cn_code: str
    description: str
    sector: str
    score: float = Field(ge=0, le=1)
    matched_default_cn_code: str
    production_route: str | None
    default_emissions_tco2e_per_tonne: float


class CnSearchResult(BaseModel):
    catalog_version: str
    query: str
    origin_country: str
    candidates: list[CnCandidate]


class ApiError(BaseModel):
    code: str
    message: str
    context: dict[str, Any] = Field(default_factory=dict)
