"use client";

import {
  Button,
  ContentSwitcher,
  Header,
  HeaderName,
  InlineNotification,
  Select,
  SelectItem,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkeletonText,
  SkipToContent,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
} from "@carbon/react";
import {
  Calculator,
  ChartLine,
  Document,
  DocumentPdf,
  Download,
  Launch,
  Renew,
  Upload,
} from "@carbon/icons-react";
import type { CSSProperties, ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { demoFallback, demoInput, demoReferenceStatus } from "@/lib/demo";
import {
  clearScenarioDraft,
  loadScenarioDraft,
  saveScenarioDraft,
} from "@/lib/draft";
import type { ImportedQuoteLine } from "@/lib/local-import";
import { buildScenarioCsv, reportFileName } from "@/lib/report";
import type {
  DemoScenario,
  EmissionsMode,
  FxVolatilityMode,
  ReferenceStatus,
  ScenarioInput,
  ScenarioResult,
} from "@/lib/types";
import { QuoteImportModal } from "@/components/quote-import-modal";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const euro = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const euroPrecise = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const percent = new Intl.NumberFormat("tr-TR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const date = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

type NumericKey = {
  [K in keyof ScenarioInput]: ScenarioInput[K] extends number ? K : never;
}[keyof ScenarioInput];

type TextKey =
  | "quote_name"
  | "product_name"
  | "destination"
  | "cn_code"
  | "import_period";

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value: string) {
  return date.format(new Date(`${value}T12:00:00Z`));
}

async function getApiError(response: Response) {
  try {
    const payload = (await response.json()) as {
      detail?:
        | string
        | { message?: string }
        | Array<{ msg?: string; loc?: Array<string | number> }>;
    };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail
        .map((item) => item.msg)
        .filter(Boolean)
        .join("; ");
    }
    if (payload.detail?.message) return payload.detail.message;
  } catch {
    // The response did not contain a structured API error.
  }
  return `Hesaplama başarısız oldu (${response.status}).`;
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "warning" | "negative";
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong className={`metric-value ${tone ? `tone-${tone}` : ""}`}>
        {value}
      </strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function Histogram({ result }: { result: ScenarioResult }) {
  const maximum = Math.max(...result.histogram.map((item) => item.count), 1);
  const first = result.histogram[0];
  const last = result.histogram[result.histogram.length - 1];

  return (
    <div className="histogram-wrap">
      <div
        className="histogram"
        role="img"
        aria-label="Simülasyon sonucunda oluşan marj dağılımı"
      >
        {result.histogram.map((item) => {
          const height = Math.max(2, (item.count / maximum) * 100);
          const style = { "--bar-height": `${height}%` } as CSSProperties;
          return (
            <div
              className="histogram-bar"
              key={`${item.start_eur}-${item.end_eur}`}
              style={style}
              tabIndex={0}
              title={`${euro.format(item.start_eur)} - ${euro.format(item.end_eur)}: ${item.count} sonuç`}
            />
          );
        })}
      </div>
      <div className="axis-labels" aria-hidden="true">
        <span>{euro.format(first.start_eur)}</span>
        <span>Simüle edilen teklif marjı</span>
        <span>{euro.format(last.end_eur)}</span>
      </div>
      <div className="percentile-grid">
        {result.percentiles.map((point) => (
          <div className="percentile-cell" key={point.percentile}>
            <span>P{point.percentile}</span>
            <strong>{euro.format(point.margin_eur)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScenarioWorkspace() {
  const [input, setInput] = useState<ScenarioInput>(demoInput);
  const [result, setResult] = useState<ScenarioResult>(demoFallback.result);
  const [references, setReferences] =
    useState<ReferenceStatus>(demoReferenceStatus);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"api" | "preview">("preview");
  const [dirty, setDirty] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDemo() {
      try {
        const [scenarioResponse, referenceResponse] = await Promise.all([
          fetch(`${API_URL}/v1/scenarios/demo`, { signal: controller.signal }),
          fetch(`${API_URL}/v1/reference-data/status`, {
            signal: controller.signal,
          }),
        ]);
        if (!scenarioResponse.ok || !referenceResponse.ok) {
          throw new Error("Hesaplama servisi başlangıç verisini döndürmedi.");
        }
        const scenario = (await scenarioResponse.json()) as DemoScenario;
        const referenceData =
          (await referenceResponse.json()) as ReferenceStatus;
        const localDraft = loadScenarioDraft();
        setInput(localDraft ?? scenario.input);
        setResult(scenario.result);
        setReferences(referenceData);
        setSourceMode("api");
        setDirty(Boolean(localDraft));
        setDraftRestored(Boolean(localDraft));
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          const localDraft = loadScenarioDraft();
          if (localDraft) {
            setInput(localDraft);
            setDirty(true);
            setDraftRestored(true);
          }
          setError(
            "Hesaplama servisine ulaşılamadı. Arayüz, aynı resmi veri anlık görüntüsünü içeren yerel önizlemeyle açık."
          );
          setSourceMode("preview");
        }
      } finally {
        setLoading(false);
        setDraftReady(true);
      }
    }

    loadDemo();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (draftReady && dirty) saveScenarioDraft(input);
  }, [draftReady, dirty, input]);

  const negativeRiskTone = useMemo(() => {
    if (result.negative_margin_probability >= 0.1) return "negative";
    if (result.negative_margin_probability >= 0.03) return "warning";
    return "positive";
  }, [result.negative_margin_probability]);

  function updateText(key: TextKey, value: string) {
    setInput((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function updateNumber(key: NumericKey, value: string) {
    setInput((current) => ({
      ...current,
      [key]: parseNumber(value, current[key]),
    }));
    setDirty(true);
  }

  function updateOptionalNumber(
    key: "verified_emissions_intensity" | "verified_sefa_intensity",
    value: string
  ) {
    setInput((current) => ({
      ...current,
      [key]: value === "" ? null : parseNumber(value, current[key] ?? 0),
    }));
    setDirty(true);
  }

  function setEmissionsMode(mode: EmissionsMode) {
    setInput((current) => ({
      ...current,
      emissions_mode: mode,
      verified_emissions_intensity:
        mode === "verified"
          ? (current.verified_emissions_intensity ??
            result.cbam.embedded_emissions_intensity)
          : null,
      verified_sefa_intensity:
        mode === "verified"
          ? (current.verified_sefa_intensity ?? result.cbam.sefa_intensity)
          : null,
    }));
    setDirty(true);
  }

  function setFxVolatilityMode(mode: FxVolatilityMode) {
    setInput((current) => ({ ...current, fx_volatility_mode: mode }));
    setDirty(true);
  }

  async function runScenario() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/v1/scenarios/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      setResult((await response.json()) as ScenarioResult);
      setSourceMode("api");
      setDirty(false);
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Senaryo çalıştırılamadı. API servisinin açık olduğunu kontrol edin."
      );
    } finally {
      setRunning(false);
    }
  }

  function resetScenario() {
    clearScenarioDraft();
    setInput(demoInput);
    setResult(demoFallback.result);
    setError(null);
    setDirty(false);
    setDraftRestored(false);
  }

  function applyImportedLine(line: ImportedQuoteLine, fileName: string) {
    const { shipmentTonnes, quoteValueEur, productionCostEur } = line;
    if (
      shipmentTonnes === null ||
      quoteValueEur === null ||
      productionCostEur === null
    ) {
      return;
    }
    const baseName = fileName.replace(/\.[^.]+$/, "");
    setInput((current) => ({
      ...current,
      quote_name: `${baseName} · satır ${line.sourceRow}`,
      product_name: line.productName,
      cn_code: line.cnCode,
      shipment_tonnes: shipmentTonnes,
      quote_value_eur: quoteValueEur,
      production_cost_eur: productionCostEur,
      emissions_mode: "default",
      verified_emissions_intensity: null,
      verified_sefa_intensity: null,
    }));
    setError(null);
    setDirty(true);
  }

  function downloadCsvReport() {
    const csv = buildScenarioCsv(input, result, references);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFileName(input, "csv");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printPdfReport() {
    const previousTitle = document.title;
    document.title = reportFileName(input, "pdf").replace(/\.pdf$/, "");
    window.addEventListener(
      "afterprint",
      () => {
        document.title = previousTitle;
      },
      { once: true }
    );
    window.print();
  }

  const cbam = result.cbam;
  const defaultMode = input.emissions_mode === "default";

  return (
    <div className="marj-shell">
      <Header aria-label="Marj çalışma alanı">
        <SkipToContent />
        <HeaderName href="#main" prefix="">
          <span className="marj-brand-mark" aria-hidden="true">
            M
          </span>
          Marj
        </HeaderName>
      </Header>

      <SideNav aria-label="Ana menü" expanded isFixedNav>
        <SideNavItems>
          <SideNavLink href="#analysis" renderIcon={ChartLine} isActive>
            Teklif analizi
          </SideNavLink>
          <SideNavLink href="#controls" renderIcon={Calculator}>
            Senaryo girdileri
          </SideNavLink>
          <SideNavLink href="#sources" renderIcon={Document}>
            Veri kaynakları
          </SideNavLink>
        </SideNavItems>
      </SideNav>

      <main className="workspace-main" id="main">
        <section className="workspace-header" aria-labelledby="workspace-title">
          <div>
            <p className="workspace-eyebrow">İhracat teklif risk çalışma alanı</p>
            <h1 id="workspace-title">{input.quote_name}</h1>
            <p>
              Teklif marjını kur, girdi maliyeti ve CBAM yükümlülüğü altında
              sınayın. Her düzenleyici hesap, kullanılan kaynağa kadar izlenebilir.
            </p>
          </div>
          <div className="header-actions">
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Upload}
              onClick={() => setImportOpen(true)}
            >
              Dosyadan başla
            </Button>
            <Button
              kind="ghost"
              size="sm"
              hasIconOnly
              renderIcon={Download}
              iconDescription="CSV raporunu indir"
              onClick={downloadCsvReport}
            />
            <Button
              kind="ghost"
              size="sm"
              hasIconOnly
              renderIcon={DocumentPdf}
              iconDescription="PDF raporu yazdır"
              onClick={printPdfReport}
            />
            {dirty && <Tag type="warm-gray">Çalıştırılmamış değişiklik</Tag>}
            {draftRestored && <Tag type="cool-gray">Cihazdaki taslak</Tag>}
            <Tag type={sourceMode === "api" ? "green" : "gray"}>
              {sourceMode === "api" ? "Resmi veri bağlı" : "Yerel önizleme"}
            </Tag>
            <Tag type="blue">Karar desteği</Tag>
          </div>
        </section>

        {draftRestored && (
          <InlineNotification
            className="draft-notice"
            kind="info"
            title="Yerel taslak geri yüklendi"
            subtitle="Yalnızca yapılandırılmış senaryo alanları bu cihazda saklandı; ham teklif dosyası kaydedilmedi. Sonuçları güncellemek için senaryoyu çalıştırın."
            lowContrast
            hideCloseButton={false}
            onCloseButtonClick={() => setDraftRestored(false)}
          />
        )}

        <section className="metric-strip" aria-label="Senaryo özeti">
          <Metric
            label="Beklenen marj"
            value={percent.format(result.expected_margin_rate)}
            detail={euro.format(result.expected_margin_eur)}
            tone={result.expected_margin_eur >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="Aşağı yönlü marj (P10)"
            value={euro.format(result.downside_margin_eur)}
            detail="Sonuçların yüzde 10 eşiği"
            tone={result.downside_margin_eur >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="Zarar olasılığı"
            value={percent.format(result.negative_margin_probability)}
            detail={`${input.simulations.toLocaleString("tr-TR")} simülasyon`}
            tone={negativeRiskTone}
          />
          <Metric
            label="CBAM etkisi"
            value={euro.format(result.cbam_cost_eur)}
            detail={`${decimal.format(cbam.certificates_required)} sertifika`}
            tone="warning"
          />
          <Metric
            label="Güvenli taban fiyat"
            value={euro.format(result.safe_floor_price_eur)}
            detail={`Hedef marj ${percent.format(input.target_margin_rate)}`}
            tone={
              result.safe_floor_price_eur <= input.quote_value_eur
                ? "positive"
                : "warning"
            }
          />
        </section>

        <div className="workspace-grid">
          <aside className="scenario-controls" id="controls">
            <p className="section-kicker">Senaryo girdileri</p>
            <h2>Teklif varsayımları</h2>
            <p className="control-copy">
              Resmi varsayılan değerlerle başlayın veya doğrulanmış tesis verisini
              kullanın.
            </p>

            <div className="control-stack">
              <TextInput
                id="quote-name"
                labelText="Teklif adı"
                value={input.quote_name}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateText("quote_name", event.target.value)
                }
              />
              <TextInput
                id="product-name"
                labelText="Ürün"
                value={input.product_name}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateText("product_name", event.target.value)
                }
              />
              <div className="control-pair">
                <Select
                  id="destination"
                  labelText="Hedef pazar"
                  value={input.destination}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateText("destination", event.target.value)
                  }
                >
                  <SelectItem value="Almanya" text="Almanya" />
                  <SelectItem value="Hollanda" text="Hollanda" />
                  <SelectItem value="İtalya" text="İtalya" />
                  <SelectItem value="Fransa" text="Fransa" />
                </Select>
                <TextInput
                  id="origin-country"
                  labelText="Menşe ülke"
                  value={input.origin_country}
                  readOnly
                  helperText="İlk veri paketi"
                />
              </div>

              <div className="control-pair">
                <TextInput
                  id="cn-code"
                  labelText="CN kodu"
                  value={input.cn_code}
                  maxLength={8}
                  pattern="[0-9]{8}"
                  helperText="8 haneli ürün kodu"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateText(
                      "cn_code",
                      event.target.value.replace(/\D/g, "").slice(0, 8)
                    )
                  }
                />
                <Select
                  id="import-period"
                  labelText="İthalat dönemi"
                  value={input.import_period}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateText("import_period", event.target.value)
                  }
                >
                  <SelectItem value="2026-Q1" text="2026 1. çeyrek" />
                  <SelectItem value="2026-Q2" text="2026 2. çeyrek" />
                </Select>
              </div>

              <fieldset className="mode-fieldset">
                <legend>Emisyon yöntemi</legend>
                <ContentSwitcher
                  size="sm"
                  selectedIndex={defaultMode ? 0 : 1}
                  onChange={({ name }) =>
                    setEmissionsMode(name as EmissionsMode)
                  }
                >
                  <Switch name="default" text="Resmi varsayılan" />
                  <Switch name="verified" text="Doğrulanmış veri" />
                </ContentSwitcher>
              </fieldset>

              {defaultMode ? (
                <div className="mode-notice">
                  <span>Son hesap eşleşmesi</span>
                  <strong>
                    CN {cbam.selection.matched_default_cn_code ?? "bekleniyor"}
                    {cbam.selection.production_route
                      ? `, rota ${cbam.selection.production_route}`
                      : ""}
                  </strong>
                  <small>
                    Türkiye varsayılan değeri ve Column B benchmark kullanılır.
                  </small>
                </div>
              ) : (
                <div className="verified-fields">
                  <TextInput
                    id="verified-emissions"
                    type="number"
                    min="0.001"
                    max="50"
                    step="0.001"
                    labelText="Doğrulanmış emisyon (tCO2e/t)"
                    value={input.verified_emissions_intensity ?? ""}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateOptionalNumber(
                        "verified_emissions_intensity",
                        event.target.value
                      )
                    }
                  />
                  <TextInput
                    id="verified-sefa"
                    type="number"
                    min="0"
                    max="50"
                    step="0.001"
                    labelText="Doğrulanmış SEFA (tCO2e/t)"
                    value={input.verified_sefa_intensity ?? ""}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateOptionalNumber(
                        "verified_sefa_intensity",
                        event.target.value
                      )
                    }
                  />
                  <p className="field-note">
                    Bu girdilerin doğrulama belgesi uygulama dışında kontrol edilir.
                  </p>
                </div>
              )}

              <div className="control-pair">
                <TextInput
                  id="quote-value"
                  type="number"
                  min="1"
                  labelText="Teklif (EUR)"
                  value={input.quote_value_eur}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber("quote_value_eur", event.target.value)
                  }
                />
                <TextInput
                  id="production-cost"
                  type="number"
                  min="1"
                  labelText="Maliyet (EUR)"
                  value={input.production_cost_eur}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber("production_cost_eur", event.target.value)
                  }
                />
              </div>

              <div className="control-pair">
                <TextInput
                  id="shipment-tonnes"
                  type="number"
                  min="0.001"
                  step="0.1"
                  labelText="Miktar (ton)"
                  value={input.shipment_tonnes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber("shipment_tonnes", event.target.value)
                  }
                />
                <TextInput
                  id="target-margin"
                  type="number"
                  min="0"
                  max="80"
                  step="0.5"
                  labelText="Hedef marj (%)"
                  value={input.target_margin_rate * 100}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber(
                      "target_margin_rate",
                      String(parseNumber(event.target.value, 0) / 100)
                    )
                  }
                />
              </div>

              <div className="control-pair">
                <TextInput
                  id="try-exposure"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  labelText="TL maliyet payı (%)"
                  value={input.try_cost_exposure_rate * 100}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber(
                      "try_cost_exposure_rate",
                      String(parseNumber(event.target.value, 0) / 100)
                    )
                  }
                />
                <Select
                  id="simulations"
                  labelText="Simülasyon"
                  value={String(input.simulations)}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateNumber("simulations", event.target.value)
                  }
                >
                  <SelectItem value="1000" text="1.000" />
                  <SelectItem value="2500" text="2.500" />
                  <SelectItem value="5000" text="5.000" />
                  <SelectItem value="10000" text="10.000" />
                </Select>
              </div>

              <div className="control-pair">
                <Select
                  id="fx-mode"
                  labelText="Kur modeli"
                  value={input.fx_volatility_mode}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setFxVolatilityMode(event.target.value as FxVolatilityMode)
                  }
                >
                  <SelectItem value="official" text="TCMB kalibreli" />
                  <SelectItem value="manual" text="Manuel varsayım" />
                </Select>
                <TextInput
                  id="delivery-horizon"
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  labelText="Teslime kalan gün"
                  value={input.delivery_horizon_days}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber("delivery_horizon_days", event.target.value)
                  }
                />
              </div>

              <div className="control-pair">
                {input.fx_volatility_mode === "manual" ? (
                  <TextInput
                    id="fx-volatility"
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    labelText="Manuel kur oynaklığı (%)"
                    value={input.fx_volatility_rate * 100}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateNumber(
                        "fx_volatility_rate",
                        String(parseNumber(event.target.value, 0) / 100)
                      )
                    }
                  />
                ) : (
                  <TextInput
                    id="fx-model-volatility"
                    labelText="Model oynaklığı (son hesap)"
                    value={`${(result.fx.model_volatility_rate * 100).toFixed(2)}%`}
                    readOnly
                  />
                )}
                <TextInput
                  id="input-volatility"
                  type="number"
                  min="0"
                  max="50"
                  step="0.1"
                  labelText="Girdi oynaklığı (%)"
                  value={input.input_cost_volatility_rate * 100}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateNumber(
                      "input_cost_volatility_rate",
                      String(parseNumber(event.target.value, 0) / 100)
                    )
                  }
                />
              </div>
            </div>

            <div className="control-actions">
              <Button
                onClick={runScenario}
                disabled={running || input.cn_code.length !== 8}
                renderIcon={running ? undefined : Calculator}
              >
                {running
                  ? "Hesaplanıyor"
                  : dirty
                    ? "Değişiklikleri hesapla"
                    : "Senaryoyu çalıştır"}
              </Button>
              <Button
                kind="ghost"
                hasIconOnly
                iconDescription="Örnek değerlere dön"
                renderIcon={Renew}
                onClick={resetScenario}
              />
            </div>
          </aside>

          <section className="analysis-area" id="analysis" aria-live="polite">
            {error && (
              <InlineNotification
                className="analysis-notice"
                kind="warning"
                title="Hesaplama bilgisi"
                subtitle={error}
                lowContrast
                hideCloseButton={false}
                onCloseButtonClick={() => setError(null)}
              />
            )}

            {loading ? (
              <div className="analysis-panel skeleton-layout" aria-label="Yükleniyor">
                <SkeletonText heading width="38%" />
                <SkeletonText paragraph lineCount={4} />
                <SkeletonText paragraph lineCount={6} />
              </div>
            ) : (
              <>
                <section className="regulatory-summary" aria-label="CBAM hesap özeti">
                  <div className="regulatory-heading">
                    <div>
                      <p className="section-kicker">Düzenleyici hesap</p>
                      <h2>CBAM yükümlülüğü</h2>
                    </div>
                    <div className="regulatory-tags">
                      <Tag type="cool-gray">{cbam.import_period}</Tag>
                      <Tag type={cbam.cscf_status === "final" ? "green" : "purple"}>
                        CSCF {cbam.cscf_status === "final" ? "nihai" : "ön değer"}
                      </Tag>
                    </div>
                  </div>
                  <div className="regulatory-grid">
                    <div>
                      <span>Brüt gömülü emisyon</span>
                      <strong>
                        {decimal.format(cbam.gross_embedded_emissions_tco2e)}
                      </strong>
                      <small>tCO2e</small>
                    </div>
                    <div>
                      <span>Serbest tahsis düzeltmesi</span>
                      <strong>
                        {decimal.format(cbam.free_allocation_adjustment_tco2e)}
                      </strong>
                      <small>tCO2e</small>
                    </div>
                    <div>
                      <span>Sertifika yükümlülüğü</span>
                      <strong>{decimal.format(cbam.certificates_required)}</strong>
                      <small>sertifika</small>
                    </div>
                    <div>
                      <span>Dönem fiyatı</span>
                      <strong>{euroPrecise.format(cbam.certificate_price_eur)}</strong>
                      <small>sertifika başına</small>
                    </div>
                  </div>
                  <div className="match-line">
                    <span>
                      {cbam.method === "default"
                        ? `CN ${cbam.cn_code} → varsayılan ${cbam.selection.matched_default_cn_code}, benchmark ${cbam.selection.matched_benchmark_cn_code}, rota ${cbam.selection.production_route}, Column ${cbam.selection.benchmark_column}`
                        : "Doğrulanmış emisyon ve SEFA yoğunlukları kullanıldı."}
                    </span>
                    <strong>
                      {cbam.threshold_signal === "shipment_alone_above"
                        ? "Bu sevkiyat 50 tonun üzerinde"
                        : "Yıllık 50 ton toplamı ayrıca kontrol edilmeli"}
                    </strong>
                  </div>
                </section>

                <div className="analysis-layout">
                  <article className="analysis-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Marj dağılımı</h2>
                        <p>
                          Kur, girdi maliyeti ve sertifika fiyatı şoklarında olası
                          sonuç aralığı
                        </p>
                      </div>
                      <Tag type="cool-gray">Monte Carlo</Tag>
                    </div>
                    <Histogram result={result} />
                  </article>

                  <article className="analysis-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Maliyet sürücüleri</h2>
                        <p>Beklenen maliyet içindeki katkı payları</p>
                      </div>
                    </div>
                    <div className="driver-list">
                      {result.contributions.map((item) => (
                        <div className="driver-row" key={item.key}>
                          <span>{item.label}</span>
                          <strong>{euro.format(item.amount_eur)}</strong>
                          <small>{percent.format(item.share_rate)} pay</small>
                        </div>
                      ))}
                    </div>
                    <div className="decision-callout">
                      <strong>
                        {result.recommended_buffer_eur > 0
                          ? `${euro.format(result.recommended_buffer_eur)} fiyat tamponu ekleyin`
                          : "Teklif hedef marj eşiğinin üzerinde"}
                      </strong>
                      <p>
                        Güvenli taban fiyat, maliyet dağılımının P90 seviyesi ve
                        hedef marj kullanılarak hesaplandı.
                      </p>
                    </div>
                  </article>
                </div>

                <section className="detail-section" id="sources">
                  <Tabs>
                    <TabList aria-label="Analiz ayrıntıları" contained>
                      <Tab>Fiyat özeti</Tab>
                      <Tab>Kur modeli</Tab>
                      <Tab>Hesap izi</Tab>
                      <Tab>Veri kaynakları</Tab>
                      <Tab>Varsayımlar</Tab>
                    </TabList>
                    <TabPanels>
                      <TabPanel>
                        <div className="detail-content table-scroll">
                          <h2 className="print-only">Fiyat özeti</h2>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Kırılım</th>
                                <th>Açıklama</th>
                                <th>Tutar</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>Teklif değeri</td>
                                <td>{input.product_name}</td>
                                <td>{euroPrecise.format(input.quote_value_eur)}</td>
                              </tr>
                              <tr>
                                <td>Üretim maliyeti</td>
                                <td>Mevcut maliyet bazı</td>
                                <td>
                                  {euroPrecise.format(input.production_cost_eur)}
                                </td>
                              </tr>
                              <tr>
                                <td>CBAM taban etkisi</td>
                                <td>
                                  {decimal.format(input.shipment_tonnes)} ton,{" "}
                                  {cbam.method === "default"
                                    ? "resmi varsayılan yöntem"
                                    : "doğrulanmış yöntem"}
                                </td>
                                <td>{euroPrecise.format(cbam.estimated_cost_eur)}</td>
                              </tr>
                              <tr>
                                <td>Beklenen marj</td>
                                <td>Simülasyon ortalaması</td>
                                <td>{euroPrecise.format(result.expected_margin_eur)}</td>
                              </tr>
                              <tr>
                                <td>Önerilen fiyat tamponu</td>
                                <td>Hedef marja göre güvenli fiyat farkı</td>
                                <td>
                                  {euroPrecise.format(result.recommended_buffer_eur)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </TabPanel>
                      <TabPanel>
                        <div className="detail-content fx-model-content">
                          <h2 className="print-only">EUR/TRY kur modeli</h2>
                          <div className="fx-model-heading">
                            <div>
                              <span>Son resmi EUR/TRY orta kuru</span>
                              <strong>
                                {decimal.format(result.fx.latest_eur_try_mid)}
                              </strong>
                              <small>
                                {formatDate(result.fx.latest_observation_date)} ·{" "}
                                {result.fx.observation_count} gözlem
                              </small>
                            </div>
                            <Tag type={result.fx.mode === "official" ? "green" : "gray"}>
                              {result.fx.mode === "official"
                                ? "TCMB modeli uygulandı"
                                : "Manuel oynaklık uygulandı"}
                            </Tag>
                          </div>
                          <div className="fx-model-grid">
                            <div>
                              <span>Uygulanan oynaklık</span>
                              <strong>{percent.format(result.fx.applied_volatility_rate)}</strong>
                              <small>{result.fx.delivery_horizon_days} takvim günü</small>
                            </div>
                            <div>
                              <span>Ham EWMA tahmini</span>
                              <strong>{percent.format(result.fx.raw_horizon_volatility_rate)}</strong>
                              <small>λ {result.fx.ewma_decay.toFixed(2)}</small>
                            </div>
                            <div>
                              <span>Kuyruk kalibrasyonu</span>
                              <strong>{result.fx.calibration_multiplier.toFixed(2)}×</strong>
                              <small>{result.fx.backtest.calibration_count} tahminle öğrenildi</small>
                            </div>
                            <div>
                              <span>20 günlük kur değişimi</span>
                              <strong>{percent.format(result.fx.recent_20_business_day_change_rate)}</strong>
                              <small>Resmi iş günü gözlemleri</small>
                            </div>
                            <div>
                              <span>Holdout %80 kapsama</span>
                              <strong>{percent.format(result.fx.backtest.calibrated_coverage_80_rate)}</strong>
                              <small>Ham {percent.format(result.fx.backtest.raw_coverage_80_rate)}</small>
                            </div>
                            <div>
                              <span>Holdout %95 kapsama</span>
                              <strong>{percent.format(result.fx.backtest.calibrated_coverage_95_rate)}</strong>
                              <small>Ham {percent.format(result.fx.backtest.raw_coverage_95_rate)}</small>
                            </div>
                          </div>
                          <p className="fx-model-note">
                            İlk %70 dönem kalibrasyon, son %30 dönem bağımsız holdout olarak
                            kullanılır. Kalibrasyon sonucu iyileştirir ancak gelecekte aynı
                            kapsamayı garanti etmez.
                          </p>
                        </div>
                      </TabPanel>
                      <TabPanel>
                        <div className="detail-content table-scroll">
                          <h2 className="print-only">CBAM hesap izi</h2>
                          <table className="data-table trace-table">
                            <thead>
                              <tr>
                                <th>Adım</th>
                                <th>Formül</th>
                                <th>Uygulanan değer</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cbam.trace.map((step, index) => (
                                <tr key={step.key}>
                                  <td>
                                    <span className="trace-index">{index + 1}</span>
                                    <strong>{step.label}</strong>
                                  </td>
                                  <td>
                                    {step.formula}
                                    {step.source_ids.length > 0 && (
                                      <small>{step.source_ids.join(", ")}</small>
                                    )}
                                  </td>
                                  <td>
                                    <code>{step.expression}</code>
                                    <small>{step.unit}</small>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </TabPanel>
                      <TabPanel>
                        <div className="detail-content">
                          <h2 className="print-only">Veri kaynakları</h2>
                          <div className="source-list">
                            <div className="source-item">
                              <div>
                                <strong>{result.fx.source_title}</strong>
                                <span>
                                  Türkiye Cumhuriyet Merkez Bankası ·{" "}
                                  {formatDate(result.fx.latest_observation_date)}
                                </span>
                              </div>
                              <p>
                                Resmi döviz alış ve satış değerlerinin aritmetik orta
                                noktası; kur modeli ve geriye dönük test girdisi.
                              </p>
                              <Tag type="green">Resmi piyasa verisi</Tag>
                              <a
                                href={result.fx.source_url}
                                target="_blank"
                                rel="noreferrer"
                                title="TCMB kur arşivini aç"
                                aria-label="TCMB kur arşivini aç"
                              >
                                <Launch size={16} />
                              </a>
                            </div>
                            {references.sources.map((source) => (
                              <div className="source-item" key={source.id}>
                                <div>
                                  <strong>{source.title}</strong>
                                  <span>
                                    {source.publisher} · {formatDate(source.published_on)}
                                  </span>
                                </div>
                                <p>{source.legal_basis}</p>
                                <Tag type={source.binding ? "green" : "gray"}>
                                  {source.binding
                                    ? "Resmi fiyat yayını"
                                    : "Bilgilendirici veri kopyası"}
                                </Tag>
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Resmi kaynağı aç"
                                  aria-label={`${source.title} kaynağını aç`}
                                >
                                  <Launch size={16} />
                                </a>
                              </div>
                            ))}
                          </div>
                          <div className="reference-notes">
                            <strong>
                              Katalog {references.catalog_version} ·{" "}
                              {references.default_value_count.toLocaleString("tr-TR")} varsayılan
                              değer ·{" "}
                              {references.benchmark_count.toLocaleString("tr-TR")} benchmark
                            </strong>
                            {references.notes.map((note) => (
                              <p key={note}>{note}</p>
                            ))}
                          </div>
                        </div>
                      </TabPanel>
                      <TabPanel>
                        <div className="detail-content assumptions-layout">
                          <h2 className="print-only">Varsayımlar ve uyarılar</h2>
                          <div>
                            <h3>Model varsayımları</h3>
                            <ul className="assumption-list">
                              {result.assumptions.map((assumption) => (
                                <li key={assumption}>{assumption}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h3>Düzenleyici uyarılar</h3>
                            <ul className="assumption-list warning-list">
                              {cbam.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                              <li>
                                Sonuç resmi beyan, doğrulama raporu veya hukuki görüş
                                değildir.
                              </li>
                            </ul>
                          </div>
                        </div>
                      </TabPanel>
                    </TabPanels>
                  </Tabs>
                </section>
              </>
            )}
          </section>
        </div>
      </main>
      <QuoteImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={applyImportedLine}
      />
    </div>
  );
}
