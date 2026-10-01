"use client";

import {
  Button,
  FileUploaderDropContainer,
  FileUploaderItem,
  InlineLoading,
  InlineNotification,
  Modal,
  RadioButton,
  Tag,
  TextInput,
} from "@carbon/react";
import { Checkmark, Search } from "@carbon/icons-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import {
  ACCEPTED_QUOTE_FILES,
  MAX_LOCAL_FILE_BYTES,
  parseLocaleNumber,
  parseQuoteFile,
  type ImportedQuoteLine,
  type LocalImportResult,
} from "@/lib/local-import";
import type { CnCandidate, CnSearchResult } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type QuoteImportModalProps = {
  open: boolean;
  onClose: () => void;
  onApply: (line: ImportedQuoteLine, fileName: string) => void;
};

function lineIsReady(line: ImportedQuoteLine) {
  return (
    line.productName.trim().length >= 2 &&
    line.cnCode.length === 8 &&
    line.shipmentTonnes !== null &&
    line.shipmentTonnes > 0 &&
    line.quoteValueEur !== null &&
    line.quoteValueEur > 0 &&
    line.productionCostEur !== null &&
    line.productionCostEur > 0
  );
}

export function QuoteImportModal({ open, onClose, onApply }: QuoteImportModalProps) {
  const [result, setResult] = useState<LocalImportResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "complete" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CnCandidate[]>([]);
  const [candidateStatus, setCandidateStatus] = useState<
    "idle" | "loading" | "complete" | "error"
  >("idle");

  const selectedLine = useMemo(
    () => result?.lines.find((line) => line.id === selectedId) ?? null,
    [result, selectedId]
  );

  function resetImport() {
    setResult(null);
    setSelectedId(null);
    setStatus("idle");
    setError(null);
    setCandidates([]);
    setCandidateStatus("idle");
  }

  async function loadCandidates(line: ImportedQuoteLine) {
    const query = line.cnCode.length >= 4 ? line.cnCode : line.productName.trim();
    if (query.length < 2) return;
    setCandidateStatus("loading");
    setCandidates([]);
    try {
      const response = await fetch(
        `${API_URL}/v1/reference-data/search?q=${encodeURIComponent(query)}&origin_country=${encodeURIComponent("Türkiye")}&limit=3`
      );
      if (!response.ok) throw new Error("CN aday servisi yanıt vermedi.");
      const payload = (await response.json()) as CnSearchResult;
      setCandidates(payload.candidates);
      setCandidateStatus("complete");
    } catch (searchError) {
      setCandidateStatus("error");
      setError(
        searchError instanceof Error
          ? searchError.message
          : "CN adayları yüklenemedi."
      );
    }
  }

  async function handleFile(file: File) {
    setStatus("parsing");
    setError(null);
    setResult(null);
    setCandidates([]);
    try {
      const parsed = await parseQuoteFile(file);
      setResult(parsed);
      setSelectedId(parsed.lines[0].id);
      setStatus("complete");
      void loadCandidates(parsed.lines[0]);
    } catch (parseError) {
      setStatus("error");
      setError(
        parseError instanceof Error ? parseError.message : "Dosya ayrıştırılamadı."
      );
    }
  }

  function selectLine(id: string) {
    const line = result?.lines.find((item) => item.id === id);
    if (!line) return;
    setSelectedId(id);
    setCandidates([]);
    setCandidateStatus("idle");
    void loadCandidates(line);
  }

  function updateLine(patch: Partial<ImportedQuoteLine>) {
    if (!selectedId) return;
    setResult((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.id === selectedId ? { ...line, ...patch } : line
            ),
          }
        : current
    );
    if (patch.productName !== undefined || patch.cnCode !== undefined) {
      setCandidates([]);
      setCandidateStatus("idle");
    }
  }

  function applySelectedLine() {
    if (!selectedLine || !result || !lineIsReady(selectedLine)) return;
    onApply(selectedLine, result.fileName);
    onClose();
  }

  return (
    <Modal
      className="quote-import-modal"
      open={open}
      size="lg"
      modalLabel="Yerel belge ayrıştırma"
      modalHeading="Teklif dosyasından başla"
      primaryButtonText="Seçili kalemi analize aktar"
      secondaryButtonText="Kapat"
      primaryButtonDisabled={!selectedLine || !lineIsReady(selectedLine)}
      onRequestSubmit={applySelectedLine}
      onRequestClose={onClose}
      hasScrollingContent
      preventCloseOnClickOutside
    >
      <div className="import-privacy-line">
        <Tag type="green">Tarayıcıda işlenir</Tag>
        <p>
          Ham dosya API&apos;ye gönderilmez. Yalnız onaylayıp analize aktardığınız
          yapılandırılmış alanlar hesaplama servisine gider.
        </p>
      </div>

      <div className="import-drop-zone">
        <FileUploaderDropContainer
          id="quote-file"
          name="quote-file"
          accept={ACCEPTED_QUOTE_FILES}
          maxFileSize={MAX_LOCAL_FILE_BYTES}
          multiple={false}
          disabled={status === "parsing"}
          labelText="CSV, XLSX veya metin tabanlı PDF seçin ya da buraya bırakın"
          onAddFiles={(_, { addedFiles }) => {
            const file = addedFiles[0];
            if (!file) return;
            if (file.invalidFileType) {
              setStatus("error");
              setError("Yalnız CSV, XLSX ve PDF dosyaları kabul edilir.");
              return;
            }
            void handleFile(file);
          }}
        />
        {status !== "idle" && (
          <FileUploaderItem
            uuid="quote-file-item"
            name={result?.fileName ?? "Teklif dosyası"}
            status={status === "parsing" ? "uploading" : "complete"}
            invalid={status === "error"}
            errorSubject="Dosya okunamadı"
            errorBody={error ?? "Dosyayı kontrol edin."}
            iconDescription="Dosyayı kaldır"
            onDelete={resetImport}
          />
        )}
      </div>

      {error && status !== "error" && (
        <InlineNotification
          kind="warning"
          lowContrast
          title="İşlem bilgisi"
          subtitle={error}
          hideCloseButton={false}
          onCloseButtonClick={() => setError(null)}
        />
      )}

      {result && (
        <>
          {result.warnings.length > 0 && (
            <div className="import-warning-band">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          <section className="import-section" aria-labelledby="detected-lines-title">
            <div className="import-section-heading">
              <div>
                <p className="section-kicker">1. Satır seçimi</p>
                <h3 id="detected-lines-title">
                  {result.lines.length} teklif kalemi bulundu
                </h3>
              </div>
              <Tag type="cool-gray">{result.format.toUpperCase()}</Tag>
            </div>
            <div className="table-scroll">
              <table className="data-table import-lines-table">
                <thead>
                  <tr>
                    <th>Seç</th>
                    <th>Satır</th>
                    <th>Ürün</th>
                    <th>CN</th>
                    <th>Ton</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <RadioButton
                          id={`line-${line.id}`}
                          name="import-line"
                          value={line.id}
                          labelText={`Satır ${line.sourceRow}`}
                          hideLabel
                          checked={line.id === selectedId}
                          onChange={() => selectLine(line.id)}
                        />
                      </td>
                      <td>{line.sourceRow}</td>
                      <td>{line.productName || "Eksik"}</td>
                      <td>{line.cnCode || "Bulunamadı"}</td>
                      <td>
                        {line.shipmentTonnes?.toLocaleString("tr-TR") ?? "Eksik"}
                      </td>
                      <td>
                        <Tag type={lineIsReady(line) ? "green" : "warm-gray"}>
                          {lineIsReady(line) ? "Hazır" : "Kontrol gerekli"}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedLine && (
            <section className="import-section" aria-labelledby="line-review-title">
              <div className="import-section-heading">
                <div>
                  <p className="section-kicker">2. Alan doğrulama</p>
                  <h3 id="line-review-title">Seçili kalemi düzeltin</h3>
                </div>
              </div>
              <div className="import-edit-grid">
                <TextInput
                  id="import-product"
                  labelText="Ürün açıklaması"
                  value={selectedLine.productName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateLine({ productName: event.target.value })
                  }
                />
                <TextInput
                  id="import-cn"
                  labelText="CN kodu"
                  value={selectedLine.cnCode}
                  maxLength={8}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateLine({
                      cnCode: event.target.value.replace(/\D/g, "").slice(0, 8),
                    })
                  }
                />
                <TextInput
                  id="import-tonnes"
                  type="number"
                  min="0.001"
                  step="0.1"
                  labelText="Miktar (ton)"
                  value={selectedLine.shipmentTonnes ?? ""}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateLine({ shipmentTonnes: parseLocaleNumber(event.target.value) })
                  }
                />
                <TextInput
                  id="import-quote"
                  type="number"
                  min="1"
                  labelText="Teklif toplamı (EUR)"
                  value={selectedLine.quoteValueEur ?? ""}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateLine({ quoteValueEur: parseLocaleNumber(event.target.value) })
                  }
                />
                <TextInput
                  id="import-cost"
                  type="number"
                  min="1"
                  labelText="Üretim maliyeti (EUR)"
                  value={selectedLine.productionCostEur ?? ""}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateLine({
                      productionCostEur: parseLocaleNumber(event.target.value),
                    })
                  }
                />
              </div>
            </section>
          )}

          {selectedLine && (
            <section className="import-section" aria-labelledby="cn-candidates-title">
              <div className="import-section-heading">
                <div>
                  <p className="section-kicker">3. İnsan onayı</p>
                  <h3 id="cn-candidates-title">Resmi katalog CN adayları</h3>
                </div>
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={Search}
                  disabled={candidateStatus === "loading"}
                  onClick={() => void loadCandidates(selectedLine)}
                >
                  Yeniden ara
                </Button>
              </div>

              {candidateStatus === "loading" && (
                <InlineLoading description="Resmi katalog taranıyor" />
              )}
              {candidateStatus === "complete" && candidates.length === 0 && (
                <p className="empty-copy">Bu açıklama için katalog adayı bulunamadı.</p>
              )}
              {candidates.length > 0 && (
                <div className="candidate-list">
                  {candidates.map((candidate) => (
                    <div className="candidate-row" key={candidate.cn_code}>
                      <div className="candidate-code">
                        <strong>{candidate.cn_code}</strong>
                        <span>%{Math.round(candidate.score * 100)} eşleşme</span>
                      </div>
                      <div>
                        <p>{candidate.description}</p>
                        <span>
                          Varsayılan {candidate.matched_default_cn_code} · Rota{" "}
                          {candidate.production_route ?? "genel"} ·{" "}
                          {candidate.default_emissions_tco2e_per_tonne.toLocaleString(
                            "tr-TR"
                          )} tCO2e/t
                        </span>
                      </div>
                      <Button
                        kind={
                          selectedLine.cnCode === candidate.cn_code
                            ? "tertiary"
                            : "ghost"
                        }
                        size="sm"
                        renderIcon={
                          selectedLine.cnCode === candidate.cn_code
                            ? Checkmark
                            : undefined
                        }
                        onClick={() => updateLine({ cnCode: candidate.cn_code })}
                      >
                        {selectedLine.cnCode === candidate.cn_code ? "Seçildi" : "Seç"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
