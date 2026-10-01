from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal

from .reference import ReferenceCatalog, get_catalog, normalize_cn_code


SIX_PLACES = Decimal("0.000001")
TWO_PLACES = Decimal("0.01")


def _decimal(value: int | float | str) -> Decimal:
    return Decimal(str(value))


def _rounded(value: Decimal, places: Decimal = SIX_PLACES) -> float:
    return float(value.quantize(places, rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class CbamCalculationInput:
    emissions_mode: Literal["default", "verified"]
    origin_country: str
    cn_code: str
    import_period: str
    shipment_tonnes: float
    verified_emissions_intensity: float | None = None
    verified_sefa_intensity: float | None = None


def calculate_cbam_exposure(
    data: CbamCalculationInput, catalog: ReferenceCatalog | None = None
) -> dict[str, Any]:
    catalog = catalog or get_catalog()
    cn_code = normalize_cn_code(data.cn_code)
    year = int(data.import_period[:4])
    certificate_price = catalog.certificate_price(data.import_period)
    mass = _decimal(data.shipment_tonnes)
    price = _decimal(certificate_price["eur_per_tco2e"])
    source_ids = {certificate_price["source_id"]}
    warnings: list[str] = []

    if data.emissions_mode == "default":
        default_value = catalog.find_default_value(data.origin_country, cn_code)
        benchmark = catalog.find_default_benchmark(
            cn_code, default_value["production_route"]
        )
        cbam_factor = _decimal(catalog.cbam_factor(year))
        cscf_record = catalog.cscf(year)
        cscf = _decimal(cscf_record["value"])
        embedded_intensity = _decimal(default_value["total_tco2e_per_tonne"])
        benchmark_intensity = _decimal(
            benchmark["column_b_tco2e_per_tonne"]
        )
        sefa_intensity = cbam_factor * cscf * benchmark_intensity
        source_ids.update(
            {
                "eu-default-values-2026-08-10",
                "eu-benchmarks-2026-02-13",
                cscf_record["source_id"],
            }
        )
        if cscf_record["status"] != "final":
            warnings.append(
                "2026 sektörler arası düzeltme faktörü, son Komisyon rehberinde ön değer olarak yayımlanmıştır."
            )
        selection = {
            "matched_default_cn_code": default_value["cn_code"],
            "matched_benchmark_cn_code": benchmark["cn_code"],
            "production_route": default_value["production_route"],
            "benchmark_column": "B",
            "benchmark_description": benchmark["description"],
        }
        trace = [
            {
                "key": "embedded_emissions",
                "label": "Gömülü emisyon",
                "formula": "ithalat miktarı × resmi varsayılan emisyon yoğunluğu",
                "expression": f"{mass} × {embedded_intensity}",
                "unit": "tCO2e",
                "source_ids": ["eu-default-values-2026-08-10"],
            },
            {
                "key": "sefa",
                "label": "Spesifik serbest tahsis düzeltmesi",
                "formula": "CBAM faktörü × CSCF × Column B benchmark",
                "expression": f"{cbam_factor} × {cscf} × {benchmark_intensity}",
                "unit": "tCO2e/t",
                "source_ids": [
                    "eu-benchmarks-2026-02-13",
                    cscf_record["source_id"],
                ],
            },
        ]
    else:
        if (
            data.verified_emissions_intensity is None
            or data.verified_sefa_intensity is None
        ):
            raise ValueError(
                "Verified mode requires both embedded emissions and SEFA intensities"
            )
        embedded_intensity = _decimal(data.verified_emissions_intensity)
        sefa_intensity = _decimal(data.verified_sefa_intensity)
        cbam_factor = _decimal(catalog.cbam_factor(year))
        cscf_record = catalog.cscf(year)
        cscf = _decimal(cscf_record["value"])
        benchmark_intensity = None
        selection = {
            "matched_default_cn_code": None,
            "matched_benchmark_cn_code": None,
            "production_route": None,
            "benchmark_column": None,
            "benchmark_description": None,
        }
        warnings.append(
            "Doğrulanmış girdiler beyan edildiği şekliyle kullanılır; belge doğrulaması bu hesabın kapsamı dışındadır."
        )
        trace = [
            {
                "key": "embedded_emissions",
                "label": "Gömülü emisyon",
                "formula": "ithalat miktarı × doğrulanmış emisyon yoğunluğu",
                "expression": f"{mass} × {embedded_intensity}",
                "unit": "tCO2e",
                "source_ids": [],
            },
            {
                "key": "sefa",
                "label": "Doğrulanmış spesifik serbest tahsis düzeltmesi",
                "formula": "tedarikçi doğrulama raporundaki SEFA",
                "expression": str(sefa_intensity),
                "unit": "tCO2e/t",
                "source_ids": [],
            },
        ]

    embedded_emissions = mass * embedded_intensity
    free_allocation_adjustment = mass * sefa_intensity
    certificates = max(Decimal("0"), embedded_emissions - free_allocation_adjustment)
    estimated_cost = certificates * price
    threshold = _decimal(catalog.threshold["annual_tonnes"])
    threshold_signal = "shipment_alone_above" if mass > threshold else "aggregate_unknown"

    free_allocation_source_ids = (
        ["eu-benchmarks-2026-02-13"] if data.emissions_mode == "default" else []
    )
    trace.extend(
        [
            {
                "key": "free_allocation_adjustment",
                "label": "Serbest tahsis düzeltmesi",
                "formula": "ithalat miktarı × SEFA",
                "expression": f"{mass} × {sefa_intensity}",
                "unit": "tCO2e",
                "source_ids": free_allocation_source_ids,
            },
            {
                "key": "certificates",
                "label": "Tahmini sertifika yükümlülüğü",
                "formula": "max(0, gömülü emisyon - serbest tahsis düzeltmesi)",
                "expression": f"max(0, {embedded_emissions} - {free_allocation_adjustment})",
                "unit": "sertifika",
                "source_ids": ["eu-free-allocation-guidance-2026-08-14"],
            },
            {
                "key": "cbam_cost",
                "label": "Tahmini CBAM maliyeti",
                "formula": "sertifika yükümlülüğü × dönem sertifika fiyatı",
                "expression": f"{certificates} × {price}",
                "unit": "EUR",
                "source_ids": [certificate_price["source_id"]],
            },
        ]
    )

    return {
        "method": data.emissions_mode,
        "catalog_version": catalog.catalog_version,
        "origin_country": data.origin_country,
        "cn_code": cn_code,
        "import_period": data.import_period,
        "shipment_tonnes": _rounded(mass),
        "embedded_emissions_intensity": _rounded(embedded_intensity),
        "benchmark_intensity": (
            _rounded(benchmark_intensity) if benchmark_intensity is not None else None
        ),
        "cbam_factor": _rounded(cbam_factor),
        "cscf": _rounded(cscf),
        "cscf_status": cscf_record["status"],
        "sefa_intensity": _rounded(sefa_intensity),
        "gross_embedded_emissions_tco2e": _rounded(embedded_emissions),
        "free_allocation_adjustment_tco2e": _rounded(free_allocation_adjustment),
        "certificates_required": _rounded(certificates),
        "certificate_price_eur": _rounded(price, TWO_PLACES),
        "estimated_cost_eur": _rounded(estimated_cost, TWO_PLACES),
        "threshold_signal": threshold_signal,
        "threshold_note": (
            "50 ton eşiği teklif başına değil, AB ithalatçısının kapsamdaki dört "
            "sektördeki yıllık toplam ithalatı üzerinden değerlendirilir."
        ),
        "selection": selection,
        "source_ids": sorted(source_ids),
        "warnings": warnings,
        "trace": trace,
    }
