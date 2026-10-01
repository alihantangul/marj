export type EmissionsMode = "default" | "verified";

export type ScenarioInput = {
  quote_name: string;
  product_name: string;
  destination: string;
  origin_country: string;
  cn_code: string;
  import_period: string;
  emissions_mode: EmissionsMode;
  quote_value_eur: number;
  production_cost_eur: number;
  shipment_tonnes: number;
  verified_emissions_intensity: number | null;
  verified_sefa_intensity: number | null;
  try_cost_exposure_rate: number;
  fx_volatility_rate: number;
  input_cost_volatility_rate: number;
  target_margin_rate: number;
  simulations: number;
  seed: number;
};
export type CalculationTraceStep = {
  key: string;
  label: string;
  formula: string;
  expression: string;
  unit: string;
  source_ids: string[];
};
export type CbamAssessment = {
  method: EmissionsMode;
  catalog_version: string;
  origin_country: string;
  cn_code: string;
  import_period: string;
  shipment_tonnes: number;
  embedded_emissions_intensity: number;
  benchmark_intensity: number | null;
  cbam_factor: number;
  cscf: number;
  cscf_status: "preliminary" | "final";
  sefa_intensity: number;
  gross_embedded_emissions_tco2e: number;
  free_allocation_adjustment_tco2e: number;
  certificates_required: number;
  certificate_price_eur: number;
  estimated_cost_eur: number;
  threshold_signal: "shipment_alone_above" | "aggregate_unknown";
  threshold_note: string;
  selection: {
    matched_default_cn_code: string | null;
    matched_benchmark_cn_code: string | null;
    production_route: string | null;
    benchmark_column: string | null;
    benchmark_description: string | null;
  };
  source_ids: string[];
  warnings: string[];
  trace: CalculationTraceStep[];
};

export type ScenarioResult = {
  scenario_id: string;
  generated_at: string;
  model_status: "decision_support";
  expected_margin_eur: number;
  expected_margin_rate: number;
  downside_margin_eur: number;
  negative_margin_probability: number;
  cbam_cost_eur: number;
  safe_floor_price_eur: number;
  recommended_buffer_eur: number;
  cbam: CbamAssessment;
  percentiles: Array<{
    percentile: 10 | 25 | 50 | 75 | 90;
    margin_eur: number;
    margin_rate: number;
  }>;
  histogram: Array<{
    start_eur: number;
    end_eur: number;
    count: number;
  }>;
  contributions: Array<{
    key: "production" | "cbam" | "risk_buffer";
    label: string;
    amount_eur: number;
    share_rate: number;
  }>;
  assumptions: string[];
};

export type DemoScenario = {
  input: ScenarioInput;
  result: ScenarioResult;
};

export type ReferenceSource = {
  id: string;
  title: string;
  publisher: string;
  published_on: string;
  legal_basis: string;
  url: string;
  binding: boolean;
  sha256?: string | null;
};

export type ReferenceStatus = {
  mode: "official_snapshot";
  catalog_version: string;
  latest_certificate_period: string;
  latest_certificate_price_eur: number;
  default_value_count: number;
  benchmark_count: number;
  sources: ReferenceSource[];
  notes: string[];
};

export type CnCandidate = {
  cn_code: string;
  description: string;
  sector: string;
  score: number;
  matched_default_cn_code: string;
  production_route: string | null;
  default_emissions_tco2e_per_tonne: number;
};

export type CnSearchResult = {
  catalog_version: string;
  query: string;
  origin_country: string;
  candidates: CnCandidate[];
};
