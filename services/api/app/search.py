from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

from .reference import ReferenceCatalog, ReferenceDataError, get_catalog


TERM_EXPANSIONS: dict[str, tuple[str, ...]] = {
    "alasim": ("alloy",),
    "alasimli": ("alloy",),
    "alasimsiz": ("non", "alloy"),
    "aluminyum": ("aluminium",),
    "boru": ("tube", "pipe"),
    "cimento": ("cement",),
    "celik": ("steel",),
    "cekilmis": ("drawn",),
    "demir": ("iron",),
    "elektrik": ("electricity",),
    "gubre": ("fertiliser",),
    "haddelenmis": ("rolled",),
    "hidrojen": ("hydrogen",),
    "levha": ("sheet", "plate"),
    "profil": ("section",),
    "sicak": ("hot",),
    "soguk": ("cold",),
    "tel": ("wire",),
    "yassi": ("flat",),
}

STOP_WORDS = {
    "a",
    "an",
    "and",
    "bir",
    "icin",
    "ile",
    "of",
    "or",
    "the",
    "ve",
    "with",
}


def _ascii_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    ascii_value = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", ascii_value).strip()


def _singular(token: str) -> str:
    if len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _tokens(value: str, *, expand_turkish: bool = False) -> list[str]:
    raw_tokens = [token for token in _ascii_text(value).split() if token not in STOP_WORDS]
    expanded: list[str] = []
    for token in raw_tokens:
        replacements = TERM_EXPANSIONS.get(token) if expand_turkish else None
        expanded.extend(replacements or (token,))
    return [_singular(token) for token in expanded]


def _text_score(query: str, description: str, sector: str) -> float:
    query_tokens = _tokens(query, expand_turkish=True)
    candidate_tokens = set(_tokens(f"{description} {sector}"))
    if not query_tokens:
        return 0.0

    query_set = set(query_tokens)
    overlap = query_set & candidate_tokens
    coverage = len(overlap) / len(query_set)
    specificity = len(overlap) / max(1, min(len(candidate_tokens), len(query_set) * 2))
    translated_query = " ".join(query_tokens)
    sequence = SequenceMatcher(
        None, translated_query, _ascii_text(description)
    ).ratio()
    phrase_bonus = 0.08 if translated_query in _ascii_text(description) else 0.0
    return min(1.0, 0.72 * coverage + 0.18 * specificity + 0.10 * sequence + phrase_bonus)


def _code_score(query_digits: str, cn_code: str) -> float:
    if cn_code == query_digits:
        return 1.0
    if cn_code.startswith(query_digits):
        return 0.88 + 0.1 * (len(query_digits) / len(cn_code))
    if query_digits.startswith(cn_code):
        return 0.72 + 0.1 * (len(cn_code) / len(query_digits))
    return 0.0


def search_cn_candidates(
    query: str,
    origin_country: str = "Türkiye",
    limit: int = 3,
    catalog: ReferenceCatalog | None = None,
) -> list[dict[str, Any]]:
    catalog = catalog or get_catalog()
    digits = re.sub(r"\D", "", query)
    is_code_query = bool(digits) and not re.search(r"[A-Za-zÇĞİÖŞÜçğıöşü]", query)
    best_by_cn: dict[str, dict[str, Any]] = {}

    for benchmark in catalog.benchmarks:
        cn_code = benchmark["cn_code"]
        score = (
            _code_score(digits, cn_code)
            if is_code_query
            else _text_score(query, benchmark["description"], benchmark["sector"])
        )
        if score <= 0:
            continue

        try:
            default_value = catalog.find_default_value(origin_country, cn_code)
        except ReferenceDataError:
            continue

        route = default_value["production_route"]
        benchmark_route = benchmark["column_b_route"]
        route_matches = route is None or benchmark_route in {None, route}
        if not route_matches:
            score *= 0.72

        candidate = {
            "cn_code": cn_code,
            "description": benchmark["description"],
            "sector": benchmark["sector"],
            "score": round(score, 4),
            "matched_default_cn_code": default_value["cn_code"],
            "production_route": route,
            "default_emissions_tco2e_per_tonne": default_value[
                "total_tco2e_per_tonne"
            ],
        }
        current = best_by_cn.get(cn_code)
        if current is None or candidate["score"] > current["score"]:
            best_by_cn[cn_code] = candidate

    ranked = sorted(
        best_by_cn.values(),
        key=lambda item: (-item["score"], item["cn_code"]),
    )
    return ranked[:limit]
