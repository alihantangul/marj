import type { ReferenceStatus, ScenarioInput, ScenarioResult } from "./types";

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportFileName(input: ScenarioInput, extension: "csv" | "pdf") {
  const slug = input.quote_name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `marj-${slug || "senaryo"}-${input.import_period.toLocaleLowerCase("tr-TR")}.${extension}`;
}

export function buildScenarioCsv(
  input: ScenarioInput,
  result: ScenarioResult,
  references: ReferenceStatus
) {
  const rows: Array<Array<string | number>> = [
    ["Bölüm", "Alan", "Değer", "Birim / açıklama"],
    ["Senaryo", "Teklif adı", input.quote_name, ""],
    ["Senaryo", "Ürün", input.product_name, ""],
    ["Senaryo", "Hedef pazar", input.destination, ""],
    ["Senaryo", "Menşe ülke", input.origin_country, ""],
    ["Senaryo", "CN kodu", input.cn_code, ""],
    ["Senaryo", "İthalat dönemi", input.import_period, ""],
    ["Senaryo", "Emisyon yöntemi", input.emissions_mode, ""],
    ["Girdi", "Teklif değeri", input.quote_value_eur, "EUR"],
    ["Girdi", "Üretim maliyeti", input.production_cost_eur, "EUR"],
    ["Girdi", "Sevkiyat", input.shipment_tonnes, "ton"],
    ["Sonuç", "Beklenen marj", result.expected_margin_eur, "EUR"],
    ["Sonuç", "Beklenen marj oranı", result.expected_margin_rate, "oran"],
    ["Sonuç", "P10 aşağı yönlü marj", result.downside_margin_eur, "EUR"],
    [
      "Sonuç",
      "Zarar olasılığı",
      result.negative_margin_probability,
      "oran",
    ],
    ["Sonuç", "Güvenli taban fiyat", result.safe_floor_price_eur, "EUR"],
    ["Sonuç", "Önerilen fiyat tamponu", result.recommended_buffer_eur, "EUR"],
    [
      "CBAM",
      "Gömülü emisyon yoğunluğu",
      result.cbam.embedded_emissions_intensity,
      "tCO2e/t",
    ],
    [
      "CBAM",
      "Brüt gömülü emisyon",
      result.cbam.gross_embedded_emissions_tco2e,
      "tCO2e",
    ],
    [
      "CBAM",
      "Serbest tahsis düzeltmesi",
      result.cbam.free_allocation_adjustment_tco2e,
      "tCO2e",
    ],
    [
      "CBAM",
      "Sertifika yükümlülüğü",
      result.cbam.certificates_required,
      "sertifika",
    ],
    ["CBAM", "Sertifika fiyatı", result.cbam.certificate_price_eur, "EUR"],
    ["CBAM", "Taban maliyet", result.cbam.estimated_cost_eur, "EUR"],
    ["Kaynak", "Katalog sürümü", references.catalog_version, ""],
  ];

  for (const [index, step] of result.cbam.trace.entries()) {
    rows.push([
      "Hesap izi",
      `${index + 1}. ${step.label}`,
      step.expression,
      `${step.unit}; ${step.formula}`,
    ]);
  }
  for (const source of references.sources) {
    if (!result.cbam.source_ids.includes(source.id)) continue;
    rows.push([
      "Kaynak",
      source.title,
      source.url,
      `${source.published_on}; ${source.legal_basis}`,
    ]);
  }
  rows.push([
    "Uyarı",
    "Kullanım sınırı",
    "Karar desteğidir; resmi beyan veya hukuki görüş değildir.",
    "",
  ]);

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}
