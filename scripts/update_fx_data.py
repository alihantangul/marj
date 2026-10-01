from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "services" / "api" / "app" / "reference_data" / "fx_catalog.json"
TCMB_HOST = "www.tcmb.gov.tr"
ARCHIVE_INDEX_URL = "https://www.tcmb.gov.tr/kurlar/kurlar_tr.html"
MAX_RESPONSE_BYTES = 1_000_000


def _archive_url(day: date) -> str:
    return f"https://{TCMB_HOST}/kurlar/{day:%Y%m}/{day:%d%m%Y}.xml"


def _download(url: str) -> bytes | None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != TCMB_HOST:
        raise ValueError(f"Unexpected TCMB URL: {url}")

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Marj reference-data updater/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError(f"TCMB returned HTTP {response.status} for {url}")
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise

    if len(body) > MAX_RESPONSE_BYTES:
        raise RuntimeError(f"TCMB response exceeded size limit for {url}")
    return body


def _parse_observation(body: bytes, url: str) -> dict[str, object]:
    root = ET.fromstring(body)
    currency = root.find("./Currency[@CurrencyCode='EUR']")
    if currency is None:
        raise ValueError(f"EUR entry is missing in {url}")

    buying_text = currency.findtext("ForexBuying")
    selling_text = currency.findtext("ForexSelling")
    if not buying_text or not selling_text:
        raise ValueError(f"EUR indicative rates are missing in {url}")

    buying = float(buying_text)
    selling = float(selling_text)
    bulletin_date = datetime.strptime(root.attrib["Tarih"], "%d.%m.%Y").date()
    return {
        "date": bulletin_date.isoformat(),
        "forex_buying": buying,
        "forex_selling": selling,
        "mid": round((buying + selling) / 2, 6),
        "bulletin_no": root.attrib.get("Bulten_No"),
        "source_url": url,
        "sha256": hashlib.sha256(body).hexdigest(),
    }


def _download_observations(
    start: date, end: date, delay_ms: int
) -> list[dict[str, object]]:
    observations: list[dict[str, object]] = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            url = _archive_url(current)
            body = _download(url)
            if body is not None:
                observation = _parse_observation(body, url)
                if observation["date"] != current.isoformat():
                    raise ValueError(f"Bulletin date mismatch in {url}")
                observations.append(observation)
            if delay_ms:
                time.sleep(delay_ms / 1_000)
        current += timedelta(days=1)
    return observations


def build_catalog(
    start: date,
    end: date,
    delay_ms: int,
    retained_observations: list[dict[str, object]] | None = None,
    fetch_start: date | None = None,
) -> dict[str, object]:
    if start > end:
        raise ValueError("Start date must not be after end date")
    if (end - start).days > 1_100:
        raise ValueError("A single update is limited to 1,100 calendar days")

    first_fetch_date = fetch_start or start
    if first_fetch_date < start or first_fetch_date > end:
        raise ValueError("Fetch start must fall inside the catalog range")

    merged = {
        str(item["date"]): item
        for item in (retained_observations or [])
        if start.isoformat() <= str(item.get("date", "")) <= end.isoformat()
    }
    for observation in _download_observations(first_fetch_date, end, delay_ms):
        merged[str(observation["date"])] = observation
    observations = [merged[key] for key in sorted(merged)]

    if len(observations) < 180:
        raise RuntimeError(
            f"Only {len(observations)} observations found; at least 180 are required"
        )

    return {
        "catalog_version": observations[-1]["date"],
        "generated_at": f"{observations[-1]['date']}T00:00:00+00:00",
        "series": "EUR/TRY indicative midpoint",
        "publisher": "Türkiye Cumhuriyet Merkez Bankası",
        "method": "Arithmetic midpoint of official indicative forex buying and selling rates",
        "archive_index_url": ARCHIVE_INDEX_URL,
        "observation_count": len(observations),
        "observations": observations,
    }


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _incremental_state(
    output: Path, start: date, end: date
) -> tuple[list[dict[str, object]], date]:
    if not output.exists():
        return [], start

    try:
        payload = json.loads(output.read_text(encoding="utf-8"))
        observations = payload["observations"]
        if not isinstance(observations, list) or not observations:
            return [], start
        latest = _parse_date(str(observations[-1]["date"]))
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return [], start

    refresh_from = max(start, latest - timedelta(days=7))
    retained = [
        item
        for item in observations
        if start.isoformat() <= str(item.get("date", "")) < refresh_from.isoformat()
        and str(item.get("date", "")) <= end.isoformat()
    ]
    return retained, refresh_from


def main() -> None:
    today = datetime.now(UTC).date()
    parser = argparse.ArgumentParser(
        description="Build a versioned EUR/TRY catalog from official TCMB bulletins."
    )
    parser.add_argument("--start", type=_parse_date, default=today - timedelta(days=550))
    parser.add_argument("--end", type=_parse_date, default=today)
    parser.add_argument("--delay-ms", type=int, default=40)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument(
        "--full",
        action="store_true",
        help="Ignore an existing catalog and fetch the complete requested range.",
    )
    args = parser.parse_args()

    output = args.output.resolve()
    retained, fetch_start = (
        ([], args.start)
        if args.full
        else _incremental_state(output, args.start, args.end)
    )
    catalog = build_catalog(
        args.start,
        args.end,
        max(0, args.delay_ms),
        retained,
        fetch_start,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(output)
    print(
        f"Wrote {catalog['observation_count']} observations through "
        f"{catalog['catalog_version']} to {output}"
    )


if __name__ == "__main__":
    main()
