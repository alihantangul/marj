import assert from "node:assert/strict";
import test from "node:test";

import {
  clearScenarioDraft,
  loadScenarioDraft,
  saveScenarioDraft,
} from "../src/lib/draft.ts";
import { normalizeApiUrl } from "../src/lib/api-url.ts";


class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}


const input = {
  quote_name: "Hamburg profil teklifi",
  product_name: "Sıcak haddelenmiş I profil",
  destination: "Almanya",
  origin_country: "Türkiye",
  cn_code: "72163211",
  import_period: "2026-Q2",
  emissions_mode: "default",
  quote_value_eur: 128460,
  production_cost_eur: 101780,
  shipment_tonnes: 84.6,
  verified_emissions_intensity: null,
  verified_sefa_intensity: null,
  try_cost_exposure_rate: 0.62,
  fx_volatility_mode: "official",
  fx_volatility_rate: 0.055,
  delivery_horizon_days: 60,
  input_cost_volatility_rate: 0.038,
  target_margin_rate: 0.12,
  simulations: 2500,
  seed: 42,
};


function installStorage() {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  return localStorage;
}


test("structured scenario draft round-trips without extra data", () => {
  installStorage();
  saveScenarioDraft(input);

  assert.deepEqual(loadScenarioDraft(), input);
});


test("corrupt and unknown-version drafts are rejected", () => {
  const storage = installStorage();
  storage.setItem("marj.scenario-draft.v1", "not-json");
  assert.equal(loadScenarioDraft(), null);

  storage.setItem(
    "marj.scenario-draft.v1",
    JSON.stringify({ version: 2, input })
  );
  assert.equal(loadScenarioDraft(), null);
});


test("reset removes the local draft", () => {
  installStorage();
  saveScenarioDraft(input);
  clearScenarioDraft();

  assert.equal(loadScenarioDraft(), null);
});


test("deployment hostnames are normalized to secure API URLs", () => {
  assert.equal(
    normalizeApiUrl("marj-api.onrender.com/"),
    "https://marj-api.onrender.com"
  );
  assert.equal(normalizeApiUrl("http://localhost:8000"), "http://localhost:8000");
});
