import json
from datetime import date, timedelta

import pytest

from scripts import update_fx_data as updater


def _observation(day: date, mid: float = 50.0) -> dict[str, object]:
    return {
        "date": day.isoformat(),
        "forex_buying": mid - 0.05,
        "forex_selling": mid + 0.05,
        "mid": mid,
        "bulletin_no": "test",
        "source_url": updater._archive_url(day),
        "sha256": "0" * 64,
    }


def test_parser_extracts_eur_midpoint_and_provenance() -> None:
    body = b"""<?xml version="1.0" encoding="UTF-8"?>
    <Tarih_Date Tarih="30.09.2026" Bulten_No="2026/184">
      <Currency CurrencyCode="EUR">
        <ForexBuying>55.5567</ForexBuying>
        <ForexSelling>55.6568</ForexSelling>
      </Currency>
    </Tarih_Date>"""
    url = "https://www.tcmb.gov.tr/kurlar/202609/30092026.xml"

    result = updater._parse_observation(body, url)

    assert result["date"] == "2026-09-30"
    assert result["mid"] == 55.60675
    assert result["source_url"] == url
    assert len(result["sha256"]) == 64


def test_downloader_rejects_non_tcmb_hosts_before_network_access() -> None:
    with pytest.raises(ValueError, match="Unexpected TCMB URL"):
        updater._download("https://example.com/rates.xml")


def test_incremental_state_keeps_history_and_refreshes_last_week(tmp_path) -> None:
    start = date(2026, 1, 1)
    end = date(2026, 10, 1)
    observations = [_observation(start + timedelta(days=index)) for index in range(273)]
    output = tmp_path / "fx_catalog.json"
    output.write_text(json.dumps({"observations": observations}), encoding="utf-8")

    retained, fetch_start = updater._incremental_state(output, start, end)

    assert fetch_start == date(2026, 9, 23)
    assert retained[-1]["date"] == "2026-09-22"


def test_catalog_merge_is_deterministic(monkeypatch) -> None:
    start = date(2025, 1, 1)
    end = start + timedelta(days=180)
    retained = [_observation(start + timedelta(days=index)) for index in range(180)]
    refreshed = _observation(end, mid=52.0)
    monkeypatch.setattr(
        updater,
        "_download_observations",
        lambda fetch_start, fetch_end, delay_ms: [refreshed],
    )

    catalog = updater.build_catalog(start, end, 0, retained, end)

    assert catalog["observation_count"] == 181
    assert catalog["catalog_version"] == end.isoformat()
    assert catalog["generated_at"] == f"{end.isoformat()}T00:00:00+00:00"
    assert catalog["observations"][-1]["mid"] == 52.0
