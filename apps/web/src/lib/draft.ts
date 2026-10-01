import type { ScenarioInput } from "./types";

const STORAGE_KEY = "marj.scenario-draft.v1";

type DraftEnvelope = {
  version: 1;
  savedAt: string;
  input: ScenarioInput;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseInput(value: unknown): ScenarioInput | null {
  if (!isRecord(value)) return null;

  const requiredStrings = [
    "quote_name",
    "product_name",
    "destination",
    "origin_country",
    "cn_code",
    "import_period",
  ] as const;
  if (
    requiredStrings.some(
      (key) => typeof value[key] !== "string" || value[key].length === 0
    )
  ) {
    return null;
  }

  const requiredNumbers = [
    "quote_value_eur",
    "production_cost_eur",
    "shipment_tonnes",
    "try_cost_exposure_rate",
    "fx_volatility_rate",
    "delivery_horizon_days",
    "input_cost_volatility_rate",
    "target_margin_rate",
    "simulations",
    "seed",
  ] as const;
  if (requiredNumbers.some((key) => !isFiniteNumber(value[key]))) return null;

  if (!/^\d{8}$/.test(value.cn_code as string)) return null;
  if (!/^20\d{2}-Q[1-4]$/.test(value.import_period as string)) return null;
  if (value.emissions_mode !== "default" && value.emissions_mode !== "verified") {
    return null;
  }
  if (
    value.fx_volatility_mode !== "official" &&
    value.fx_volatility_mode !== "manual"
  ) {
    return null;
  }

  const verifiedEmissions = value.verified_emissions_intensity;
  const verifiedSefa = value.verified_sefa_intensity;
  if (
    (verifiedEmissions !== null && !isFiniteNumber(verifiedEmissions)) ||
    (verifiedSefa !== null && !isFiniteNumber(verifiedSefa))
  ) {
    return null;
  }

  return {
    quote_name: value.quote_name as string,
    product_name: value.product_name as string,
    destination: value.destination as string,
    origin_country: value.origin_country as string,
    cn_code: value.cn_code as string,
    import_period: value.import_period as string,
    emissions_mode: value.emissions_mode,
    quote_value_eur: value.quote_value_eur as number,
    production_cost_eur: value.production_cost_eur as number,
    shipment_tonnes: value.shipment_tonnes as number,
    verified_emissions_intensity: verifiedEmissions as number | null,
    verified_sefa_intensity: verifiedSefa as number | null,
    try_cost_exposure_rate: value.try_cost_exposure_rate as number,
    fx_volatility_mode: value.fx_volatility_mode,
    fx_volatility_rate: value.fx_volatility_rate as number,
    delivery_horizon_days: value.delivery_horizon_days as number,
    input_cost_volatility_rate: value.input_cost_volatility_rate as number,
    target_margin_rate: value.target_margin_rate as number,
    simulations: value.simulations as number,
    seed: value.seed as number,
  };
}

export function loadScenarioDraft(): ScenarioInput | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || envelope.version !== 1) return null;
    return parseInput(envelope.input);
  } catch {
    return null;
  }
}

export function saveScenarioDraft(input: ScenarioInput) {
  const envelope: DraftEnvelope = {
    version: 1,
    savedAt: new Date().toISOString(),
    input,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function clearScenarioDraft() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Resetting the in-memory scenario still works when storage is unavailable.
  }
}
