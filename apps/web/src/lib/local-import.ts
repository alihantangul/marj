export const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_QUOTE_FILES = [".csv", ".xlsx", ".pdf"];

export type ImportedQuoteLine = {
  id: string;
  sourceRow: number;
  productName: string;
  cnCode: string;
  shipmentTonnes: number | null;
  quoteValueEur: number | null;
  productionCostEur: number | null;
  warnings: string[];
};

export type LocalImportResult = {
  fileName: string;
  format: "csv" | "xlsx" | "pdf";
  lines: ImportedQuoteLine[];
  warnings: string[];
  rawFileUploaded: false;
};

type QuoteField =
  | "productName"
  | "cnCode"
  | "shipmentTonnes"
  | "quoteValueEur"
  | "productionCostEur";

type Matrix = unknown[][];

const HEADER_ALIASES: Record<QuoteField, string[]> = {
  productName: [
    "urun",
    "urun adi",
    "product",
    "product name",
    "description",
    "aciklama",
    "item",
    "item description",
    "malzeme",
    "kalem",
  ],
  cnCode: [
    "cn",
    "cn code",
    "cn kodu",
    "gtip",
    "gtip kodu",
    "hs code",
    "tarife",
    "tarife pozisyonu",
  ],
  shipmentTonnes: [
    "miktar ton",
    "miktar t",
    "tonaj",
    "tonnage",
    "quantity tonnes",
    "quantity t",
    "weight tonnes",
    "net weight t",
    "miktar",
  ],
  quoteValueEur: [
    "teklif eur",
    "teklif toplami",
    "teklif tutari",
    "satis toplami",
    "quote value",
    "quote total",
    "sales total",
    "total revenue",
  ],
  productionCostEur: [
    "maliyet eur",
    "uretim maliyeti",
    "toplam maliyet",
    "production cost",
    "total cost",
    "cost eur",
    "maliyet",
  ],
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerField(value: unknown): QuoteField | null {
  const normalized = normalizeText(value);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [QuoteField, string[]]
  >) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;

  let normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/(?:EUR|TRY|TL|€|₺)/gi, "")
    .replace(/[^0-9,.-]/g, "");
  if (!normalized || normalized === "-" || normalized === ".") return null;

  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.replaceAll(thousandsSeparator, "");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (comma >= 0) {
    const decimalDigits = normalized.length - comma - 1;
    normalized =
      decimalDigits === 3 && /^-?\d{1,3}(,\d{3})+$/.test(normalized)
        ? normalized.replaceAll(",", "")
        : normalized.replace(",", ".");
  } else if (dot >= 0) {
    const decimalDigits = normalized.length - dot - 1;
    if (decimalDigits === 3 && /^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replaceAll(".", "");
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCnCode(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function makeId(row: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `line-${row}-${Date.now()}`;
}

function findHeader(matrix: Matrix) {
  let best: { row: number; columns: Partial<Record<QuoteField, number>>; score: number } = {
    row: -1,
    columns: {},
    score: 0,
  };

  matrix.slice(0, 15).forEach((row, rowIndex) => {
    const columns: Partial<Record<QuoteField, number>> = {};
    row.forEach((cell, columnIndex) => {
      const field = headerField(cell);
      if (field && columns[field] === undefined) columns[field] = columnIndex;
    });
    const score = Object.keys(columns).length;
    if (score > best.score) best = { row: rowIndex, columns, score };
  });

  if (best.score < 2 || best.columns.productName === undefined) {
    throw new Error(
      "Ürün adıyla birlikte en az bir CN, tonaj, teklif veya maliyet sütunu bulunamadı."
    );
  }
  return best;
}

function matrixToLines(matrix: Matrix): { lines: ImportedQuoteLine[]; warnings: string[] } {
  const header = findHeader(matrix);
  const warnings: string[] = [];
  if (header.columns.cnCode === undefined) {
    warnings.push("CN kodu sütunu bulunamadı; ürün açıklamasından aday aranacak.");
  }
  if (header.columns.shipmentTonnes === undefined) {
    warnings.push("Tonaj sütunu bulunamadı; satırları hesaplamadan önce tamamlayın.");
  }

  const lines = matrix
    .slice(header.row + 1, header.row + 101)
    .map((row, index): ImportedQuoteLine | null => {
      const productName = String(
        row[header.columns.productName as number] ?? ""
      ).trim();
      const cnCode =
        header.columns.cnCode === undefined
          ? ""
          : normalizeCnCode(row[header.columns.cnCode]);
      if (!productName && !cnCode) return null;

      const shipmentTonnes =
        header.columns.shipmentTonnes === undefined
          ? null
          : parseLocaleNumber(row[header.columns.shipmentTonnes]);
      const quoteValueEur =
        header.columns.quoteValueEur === undefined
          ? null
          : parseLocaleNumber(row[header.columns.quoteValueEur]);
      const productionCostEur =
        header.columns.productionCostEur === undefined
          ? null
          : parseLocaleNumber(row[header.columns.productionCostEur]);
      const lineWarnings: string[] = [];
      if (cnCode && cnCode.length !== 8) lineWarnings.push("CN kodu 8 haneli değil.");
      if (shipmentTonnes === null) lineWarnings.push("Tonaj eksik.");
      if (quoteValueEur === null) lineWarnings.push("Teklif tutarı eksik.");
      if (productionCostEur === null) lineWarnings.push("Maliyet eksik.");

      return {
        id: makeId(header.row + index + 2),
        sourceRow: header.row + index + 2,
        productName,
        cnCode,
        shipmentTonnes,
        quoteValueEur,
        productionCostEur,
        warnings: lineWarnings,
      };
    })
    .filter((line): line is ImportedQuoteLine => line !== null);

  if (matrix.length > header.row + 101) {
    warnings.push("Önizleme performansı için ilk 100 veri satırı alındı.");
  }
  if (lines.length === 0) throw new Error("Dosyada kullanılabilir teklif satırı bulunamadı.");
  return { lines, warnings };
}

async function parseCsv(file: File): Promise<Matrix> {
  const Papa = (await import("papaparse")).default;
  const result = Papa.parse<unknown[]>(await file.text(), {
    skipEmptyLines: "greedy",
  });
  if (result.errors.some((error) => error.type === "Delimiter")) {
    throw new Error("CSV ayıracı güvenilir biçimde belirlenemedi.");
  }
  return result.data;
}

async function parseXlsx(file: File): Promise<Matrix> {
  const { readSheet } = await import("read-excel-file/browser");
  return readSheet(file);
}

function valueNearLabel(lines: string[], labels: RegExp) {
  const currency = /(?:EUR|€)\s*([\d.,]+)|([\d.,]+)\s*(?:EUR|€)/i;
  for (const line of lines) {
    if (!labels.test(line)) continue;
    const match = line.match(currency);
    const value = parseLocaleNumber(match?.[1] ?? match?.[2]);
    if (value !== null) return value;
  }
  return null;
}

function pdfTextToLines(text: string): { lines: ImportedQuoteLine[]; warnings: string[] } {
  const textLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const quoteValueEur = valueNearLabel(
    textLines,
    /teklif|toplam|quote|sales total|total value/i
  );
  const productionCostEur = valueNearLabel(
    textLines,
    /maliyet|cost|production cost/i
  );
  const matches: ImportedQuoteLine[] = [];

  textLines.forEach((line, index) => {
    const cnMatch = line.match(/\b(\d{8})\b/);
    if (!cnMatch) return;
    const context = textLines.slice(Math.max(0, index - 1), index + 3).join(" ");
    const tonnesMatch = context.match(/([\d.,]+)\s*(?:t|ton|tonne|tonnes)\b/i);
    const productFromLine = line.replace(cnMatch[0], "").replace(/^[-–:|\s]+/, "").trim();
    const productName = productFromLine || textLines[Math.max(0, index - 1)] || "Ürün";
    const shipmentTonnes = parseLocaleNumber(tonnesMatch?.[1]);
    const lineWarnings: string[] = [];
    if (shipmentTonnes === null) lineWarnings.push("Tonaj PDF metninden bulunamadı.");
    if (quoteValueEur === null) lineWarnings.push("Teklif tutarı PDF metninden bulunamadı.");
    if (productionCostEur === null) lineWarnings.push("Maliyet PDF metninden bulunamadı.");
    matches.push({
      id: makeId(index + 1),
      sourceRow: index + 1,
      productName,
      cnCode: cnMatch[1],
      shipmentTonnes,
      quoteValueEur: matches.length === 0 ? quoteValueEur : null,
      productionCostEur: matches.length === 0 ? productionCostEur : null,
      warnings: lineWarnings,
    });
  });

  if (matches.length === 0) {
    const productName =
      textLines.find((line) => /[A-Za-zÇĞİÖŞÜçğıöşü]{4}/.test(line)) ?? "Ürün";
    matches.push({
      id: makeId(1),
      sourceRow: 1,
      productName,
      cnCode: "",
      shipmentTonnes: null,
      quoteValueEur,
      productionCostEur,
      warnings: ["CN kodu ve tonaj PDF metninden bulunamadı."],
    });
  }

  return {
    lines: matches.slice(0, 100),
    warnings: [
      "PDF metin katmanı sezgisel olarak ayrıştırıldı; alanları hesaplamadan önce doğrulayın.",
    ],
  };
}

async function parsePdf(file: File) {
  const pdfjs =
    typeof window === "undefined"
      ? await import("pdfjs-dist/legacy/build/pdf.mjs")
      : await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    typeof window === "undefined"
      ? new URL(
          "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString()
      : new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let current = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      current += `${current ? " " : ""}${item.str}`;
      if (item.hasEOL) {
        lines.push(current);
        current = "";
      }
    }
    if (current) lines.push(current);
    pages.push(lines.join("\n"));
  }

  const text = pages.join("\n");
  if (text.trim().length < 20) {
    throw new Error(
      "PDF içinde metin katmanı bulunamadı. Taranmış belgeler bu sürümde desteklenmiyor."
    );
  }
  return pdfTextToLines(text);
}

export async function parseQuoteFile(file: File): Promise<LocalImportResult> {
  if (file.size > MAX_LOCAL_FILE_BYTES) {
    throw new Error("Dosya 10 MB sınırını aşıyor.");
  }
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("tr-TR");
  if (extension !== "csv" && extension !== "xlsx" && extension !== "pdf") {
    throw new Error("Yalnız CSV, XLSX ve metin tabanlı PDF dosyaları kabul edilir.");
  }

  if (extension === "pdf") {
    const parsed = await parsePdf(file);
    return {
      fileName: file.name,
      format: "pdf",
      ...parsed,
      rawFileUploaded: false,
    };
  }

  const matrix = extension === "csv" ? await parseCsv(file) : await parseXlsx(file);
  const parsed = matrixToLines(matrix);
  return {
    fileName: file.name,
    format: extension,
    ...parsed,
    rawFileUploaded: false,
  };
}
