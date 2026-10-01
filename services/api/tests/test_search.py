from app.search import search_cn_candidates


def test_exact_cn_query_ranks_exact_candidate_first() -> None:
    candidates = search_cn_candidates("72163211")

    assert candidates[0]["cn_code"] == "72163211"
    assert candidates[0]["score"] == 1.0
    assert candidates[0]["matched_default_cn_code"] == "7216"


def test_turkish_product_query_returns_relevant_i_section() -> None:
    candidates = search_cn_candidates("sıcak haddelenmiş I çelik profil", limit=5)

    assert any(item["cn_code"] == "72163211" for item in candidates)
    assert all(item["score"] > 0 for item in candidates)


def test_results_are_limited_and_include_official_default_context() -> None:
    candidates = search_cn_candidates("alüminyum profil", limit=3)

    assert len(candidates) == 3
    assert all(item["matched_default_cn_code"] for item in candidates)
    assert all(item["default_emissions_tco2e_per_tonne"] > 0 for item in candidates)
