from __future__ import annotations

import json
from functools import lru_cache
from math import ceil, exp, floor, log, sqrt
from pathlib import Path
from statistics import mean
from typing import Literal


FX_CATALOG_PATH = Path(__file__).parent / "reference_data" / "fx_catalog.json"
TRADING_DAYS_PER_YEAR = 252
EWMA_DECAY = 0.94


class FxDataError(ValueError):
    pass


@lru_cache(maxsize=1)
def get_fx_catalog() -> dict[str, object]:
    try:
        with FX_CATALOG_PATH.open(encoding="utf-8") as source:
            payload = json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise FxDataError("TCMB EUR/TRY snapshot could not be loaded") from error

    observations = payload.get("observations")
    if not isinstance(observations, list) or len(observations) < 180:
        raise FxDataError("TCMB EUR/TRY snapshot has insufficient observations")
    return payload


def _ewma_daily_volatility(returns: list[float]) -> float:
    if len(returns) < 20:
        raise FxDataError("At least 20 returns are required for EWMA volatility")

    warmup = min(20, len(returns))
    variance = mean(value * value for value in returns[:warmup])
    for value in returns[warmup:]:
        variance = EWMA_DECAY * variance + (1 - EWMA_DECAY) * value * value
    return sqrt(variance)


def _log_returns(prices: list[float]) -> list[float]:
    return [log(current / previous) for previous, current in zip(prices, prices[1:])]


def _percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = floor(position)
    upper = ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _backtest(prices: list[float]) -> dict[str, float | int]:
    lookback = 126
    horizon = 20
    if len(prices) <= lookback + horizon:
        raise FxDataError("TCMB EUR/TRY snapshot is too short for backtesting")

    returns = _log_returns(prices)
    actual_returns: list[float] = []
    forecast_sigmas: list[float] = []
    for origin in range(lookback, len(prices) - horizon):
        history = returns[origin - lookback : origin]
        forecast_sigma = _ewma_daily_volatility(history) * sqrt(horizon)
        actual = log(prices[origin + horizon] / prices[origin])
        actual_returns.append(actual)
        forecast_sigmas.append(forecast_sigma)

    count = len(actual_returns)
    split = max(30, round(count * 0.7))
    calibration_ratios = [
        abs(actual) / sigma
        for actual, sigma in zip(actual_returns[:split], forecast_sigmas[:split])
    ]
    calibration_multiplier = max(
        1.0,
        _percentile(calibration_ratios, 0.80) / 1.281552,
        _percentile(calibration_ratios, 0.95) / 1.959964,
    )
    holdout_actual = actual_returns[split:]
    holdout_sigmas = forecast_sigmas[split:]

    def coverage(z_score: float, multiplier: float) -> float:
        covered = sum(
            abs(actual) <= z_score * sigma * multiplier
            for actual, sigma in zip(holdout_actual, holdout_sigmas)
        )
        return covered / len(holdout_actual)

    return {
        "forecast_count": count,
        "calibration_count": split,
        "holdout_count": len(holdout_actual),
        "lookback_business_days": lookback,
        "horizon_business_days": horizon,
        "calibration_multiplier": round(calibration_multiplier, 6),
        "raw_coverage_80_rate": round(coverage(1.281552, 1.0), 5),
        "raw_coverage_95_rate": round(coverage(1.959964, 1.0), 5),
        "calibrated_coverage_80_rate": round(
            coverage(1.281552, calibration_multiplier), 5
        ),
        "calibrated_coverage_95_rate": round(
            coverage(1.959964, calibration_multiplier), 5
        ),
        "mean_absolute_actual_return_rate": round(
            mean(abs(value) for value in holdout_actual), 6
        ),
        "mean_raw_forecast_volatility_rate": round(mean(holdout_sigmas), 6),
    }


def _official_model(delivery_horizon_days: int) -> dict[str, object]:
    catalog = get_fx_catalog()
    observations = catalog["observations"]
    if not isinstance(observations, list):
        raise FxDataError("TCMB EUR/TRY observations are invalid")

    prices = [float(item["mid"]) for item in observations]
    returns = _log_returns(prices)
    daily_volatility = _ewma_daily_volatility(returns)
    business_horizon = max(
        1, round(delivery_horizon_days * TRADING_DAYS_PER_YEAR / 365)
    )
    latest = observations[-1]
    comparison_index = max(0, len(prices) - 21)
    recent_change = prices[-1] / prices[comparison_index] - 1

    backtest = _backtest(prices)
    calibration_multiplier = float(backtest["calibration_multiplier"])
    raw_horizon_volatility = daily_volatility * sqrt(business_horizon)

    return {
        "source_id": "tcmb-eur-try",
        "source_title": "TCMB Gösterge Niteliğindeki Döviz Kurları",
        "source_url": catalog["archive_index_url"],
        "catalog_version": catalog["catalog_version"],
        "latest_observation_date": latest["date"],
        "latest_eur_try_mid": round(prices[-1], 6),
        "observation_count": len(prices),
        "ewma_decay": EWMA_DECAY,
        "daily_volatility_rate": round(daily_volatility, 6),
        "annualized_volatility_rate": round(
            daily_volatility * sqrt(TRADING_DAYS_PER_YEAR), 6
        ),
        "horizon_business_days": business_horizon,
        "raw_horizon_volatility_rate": round(raw_horizon_volatility, 6),
        "calibration_multiplier": round(calibration_multiplier, 6),
        "model_volatility_rate": round(
            raw_horizon_volatility * calibration_multiplier, 6
        ),
        "recent_20_business_day_change_rate": round(recent_change, 6),
        "backtest": backtest,
    }


def get_fx_assessment(
    mode: Literal["official", "manual"],
    manual_volatility_rate: float,
    delivery_horizon_days: int,
) -> dict[str, object]:
    model = _official_model(delivery_horizon_days)
    model["mode"] = mode
    model["delivery_horizon_days"] = delivery_horizon_days
    model["applied_volatility_rate"] = (
        model["model_volatility_rate"]
        if mode == "official"
        else round(manual_volatility_rate, 6)
    )
    return model


def sample_eur_try_change(random_value: float, volatility_rate: float) -> float:
    return exp(-0.5 * volatility_rate**2 + volatility_rate * random_value) - 1
