import os
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .engine import run_scenario
from .fx import FxDataError, get_fx_assessment, get_fx_catalog
from .reference import ReferenceDataError, get_catalog, normalize_cn_code
from .schemas import (
    CnSearchResult,
    DemoScenario,
    FxAssessment,
    ReferenceStatus,
    ScenarioInput,
    ScenarioResult,
)
from .search import search_cn_candidates


def _csv_environment(name: str, default: str) -> list[str]:
    return [value.strip() for value in os.getenv(name, default).split(",") if value.strip()]


def _normalize_origin(value: str) -> str:
    origin = value.strip().rstrip("/")
    if origin.startswith(("http://", "https://")):
        return origin
    return f"https://{origin}"


ALLOWED_ORIGINS = _csv_environment(
    "MARJ_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
ALLOWED_ORIGINS = [_normalize_origin(value) for value in ALLOWED_ORIGINS]

app = FastAPI(
    title="Marj Scenario API",
    version="0.3.0",
    description="İhracat teklifleri için kaynak izli marj ve CBAM risk motoru.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Any, call_next: Any) -> Any:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


def demo_input() -> ScenarioInput:
    return ScenarioInput(
        quote_name="Hamburg profil teklifi",
        product_name="Sıcak haddelenmiş I profil",
        destination="Almanya",
        origin_country="Türkiye",
        cn_code="72163211",
        import_period="2026-Q2",
        emissions_mode="default",
        quote_value_eur=128_460,
        production_cost_eur=101_780,
        shipment_tonnes=84.6,
        try_cost_exposure_rate=0.62,
        fx_volatility_mode="official",
        fx_volatility_rate=0.055,
        delivery_horizon_days=60,
        input_cost_volatility_rate=0.038,
        target_margin_rate=0.12,
        simulations=2_500,
        seed=42,
    )


def _reference_error(error: ReferenceDataError) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={
            "code": "reference_data_unavailable",
            "message": str(error),
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "marj-scenario-api",
        "catalog_version": get_catalog().catalog_version,
        "fx_catalog_version": str(get_fx_catalog()["catalog_version"]),
    }


@app.get("/v1/scenarios/demo", response_model=DemoScenario)
def get_demo_scenario() -> DemoScenario:
    data = demo_input()
    return DemoScenario(input=data, result=run_scenario(data))


@app.post("/v1/scenarios/run", response_model=ScenarioResult)
def calculate_scenario(data: ScenarioInput) -> ScenarioResult:
    try:
        return run_scenario(data)
    except (ReferenceDataError, FxDataError) as error:
        raise _reference_error(error) from error


@app.get("/v1/market-data/eur-try", response_model=FxAssessment)
def eur_try_market_data(
    delivery_horizon_days: int = Query(default=60, ge=1, le=365),
) -> FxAssessment:
    try:
        return FxAssessment.model_validate(
            get_fx_assessment("official", 0, delivery_horizon_days)
        )
    except FxDataError as error:
        raise _reference_error(error) from error


@app.get("/v1/reference-data/cn/{cn_code}")
def resolve_cn_reference(
    cn_code: str, origin_country: str = "Türkiye"
) -> dict[str, Any]:
    catalog = get_catalog()
    try:
        normalized = normalize_cn_code(cn_code)
        default_value = catalog.find_default_value(origin_country, normalized)
        benchmark = catalog.find_default_benchmark(
            normalized, default_value["production_route"]
        )
    except ReferenceDataError as error:
        raise _reference_error(error) from error
    return {
        "catalog_version": catalog.catalog_version,
        "origin_country": origin_country,
        "requested_cn_code": normalized,
        "default_value": default_value,
        "benchmark": benchmark,
    }


@app.get("/v1/reference-data/status", response_model=ReferenceStatus)
def reference_data_status() -> ReferenceStatus:
    catalog = get_catalog()
    prices = catalog.payload["certificate_prices"]
    latest_price = prices[-1]
    return ReferenceStatus(
        mode="official_snapshot",
        catalog_version=catalog.catalog_version,
        latest_certificate_period=latest_price["period"],
        latest_certificate_price_eur=latest_price["eur_per_tco2e"],
        default_value_count=len(catalog.default_values),
        benchmark_count=len(catalog.benchmarks),
        sources=catalog.payload["sources"],
        notes=[
            "Excel çalışma kitapları bilgilendirici kopyalardır; atıf yapılan AB düzenlemeleri bağlayıcıdır.",
            "2026 CSCF değeri, 14 Ağustos 2026 tarihli Komisyon rehberinde ön değer olarak işaretlenmiştir.",
            "Bu katalog sürümünde 2026 üçüncü çeyrek sertifika fiyatı henüz yayımlanmamıştır.",
        ],
    )


@app.get("/v1/reference-data/search", response_model=CnSearchResult)
def search_reference_data(
    q: str = Query(min_length=2, max_length=120),
    origin_country: str = Query(default="Türkiye", min_length=2, max_length=80),
    limit: int = Query(default=3, ge=1, le=10),
) -> CnSearchResult:
    catalog = get_catalog()
    return CnSearchResult(
        catalog_version=catalog.catalog_version,
        query=q,
        origin_country=origin_country,
        candidates=search_cn_candidates(q, origin_country, limit, catalog),
    )
