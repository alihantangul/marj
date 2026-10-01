from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).parent / "reference_data" / "catalog.json"


class ReferenceDataError(ValueError):
    """Raised when an official reference cannot be resolved unambiguously."""


def normalize_cn_code(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) not in {4, 6, 8, 10}:
        raise ReferenceDataError("CN code must contain 4, 6, 8, or 10 digits")
    return digits


class ReferenceCatalog:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.catalog_version = str(payload["catalog_version"])
        self.sources = {item["id"]: item for item in payload["sources"]}
        self.default_values = list(payload["default_values"])
        self.benchmarks = list(payload["benchmarks"])

    def certificate_price(self, period: str) -> dict[str, Any]:
        match = next(
            (
                item
                for item in self.payload["certificate_prices"]
                if item["period"] == period
            ),
            None,
        )
        if match is None:
            raise ReferenceDataError(
                f"No published CBAM certificate price is available for {period}"
            )
        return match

    def cbam_factor(self, year: int) -> float:
        try:
            return float(self.payload["cbam_factors"][str(year)])
        except KeyError as error:
            raise ReferenceDataError(f"No CBAM factor is available for {year}") from error

    def cscf(self, year: int) -> dict[str, Any]:
        try:
            return self.payload["cscf"][str(year)]
        except KeyError as error:
            raise ReferenceDataError(f"No CSCF value is available for {year}") from error

    def find_default_value(self, origin_country: str, cn_code: str) -> dict[str, Any]:
        normalized = normalize_cn_code(cn_code)
        candidates = [
            item
            for item in self.default_values
            if item["origin_country"].casefold() == origin_country.casefold()
            and normalized.startswith(item["cn_code"])
        ]
        if not candidates:
            raise ReferenceDataError(
                f"No default emission value is available for {origin_country}, CN {normalized}"
            )
        return max(candidates, key=lambda item: len(item["cn_code"]))

    def find_default_benchmark(
        self, cn_code: str, production_route: str | None
    ) -> dict[str, Any]:
        normalized = normalize_cn_code(cn_code)
        candidates = [
            item
            for item in self.benchmarks
            if normalized.startswith(item["cn_code"])
            or item["cn_code"].startswith(normalized)
        ]
        if not candidates:
            raise ReferenceDataError(
                f"No free-allocation benchmark is available for CN {normalized}"
            )

        exact = [item for item in candidates if item["cn_code"] == normalized]
        if exact:
            candidates = exact
        else:
            longest = max(len(item["cn_code"]) for item in candidates)
            candidates = [item for item in candidates if len(item["cn_code"]) == longest]

        if production_route:
            route_matches = [
                item
                for item in candidates
                if item["column_b_route"] == production_route
            ]
            if route_matches:
                candidates = route_matches
            elif any(item["column_b_route"] for item in candidates):
                raise ReferenceDataError(
                    f"No Column B benchmark matches production route {production_route} "
                    f"for CN {normalized}"
                )

        candidates = [
            item
            for item in candidates
            if item["column_b_tco2e_per_tonne"] is not None
        ]
        if len(candidates) != 1:
            raise ReferenceDataError(
                f"Benchmark selection for CN {normalized} is ambiguous; use an 8-digit CN code"
            )
        return candidates[0]

    @property
    def threshold(self) -> dict[str, Any]:
        return self.payload["threshold"]


@lru_cache(maxsize=1)
def get_catalog() -> ReferenceCatalog:
    with CATALOG_PATH.open(encoding="utf-8") as source:
        return ReferenceCatalog(json.load(source))
