from fastapi.testclient import TestClient

from app.main import _normalize_origin, app


client = TestClient(app)


def test_deployment_hostname_is_normalized_to_https_origin() -> None:
    assert _normalize_origin("marj-web.onrender.com/") == "https://marj-web.onrender.com"
    assert _normalize_origin("http://localhost:3000/") == "http://localhost:3000"


def test_health_exposes_catalog_version() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["catalog_version"] == "2026-08-10"
    assert response.json()["fx_catalog_version"] == "2026-09-30"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


def test_cors_allows_local_web_and_rejects_unknown_origin() -> None:
    allowed = client.options(
        "/v1/scenarios/run",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    rejected = client.options(
        "/v1/scenarios/run",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_cn_resolution_is_explainable() -> None:
    response = client.get("/v1/reference-data/cn/72163211")

    assert response.status_code == 200
    body = response.json()
    assert body["default_value"]["cn_code"] == "7216"
    assert body["benchmark"]["column_b_route"] == "(C)"


def test_unpublished_price_returns_structured_422() -> None:
    demo = client.get("/v1/scenarios/demo").json()["input"]
    demo["import_period"] = "2026-Q3"

    response = client.post("/v1/scenarios/run", json=demo)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "reference_data_unavailable"


def test_cn_search_contract() -> None:
    response = client.get(
        "/v1/reference-data/search",
        params={"q": "sıcak haddelenmiş I çelik profil", "limit": 3},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["catalog_version"] == "2026-08-10"
    assert len(body["candidates"]) == 3


def test_eur_try_endpoint_exposes_model_and_holdout_metrics() -> None:
    response = client.get(
        "/v1/market-data/eur-try", params={"delivery_horizon_days": 60}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source_id"] == "tcmb-eur-try"
    assert body["latest_observation_date"] == "2026-09-30"
    assert body["delivery_horizon_days"] == 60
    assert body["applied_volatility_rate"] == body["model_volatility_rate"]
    assert body["backtest"]["holdout_count"] >= 50
