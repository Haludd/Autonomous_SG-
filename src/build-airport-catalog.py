"""Build the 322-airport map catalog from downloaded OurAirports CSVs.

Usage: python3 src/build-airport-catalog.py /path/to/ourairports-downloads
The original organizer inputs are never modified. No map tiles are downloaded.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://davidmegginson.github.io/ourairports-data/"


def number(value):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def example_order(item):
    row = item["record"]
    weather, departure = int(row["WEATHER_DELAY"] or 0), int(row["DEPARTURE_DELAY"] or 0)
    arrival = str(row["SCHEDULED_ARRIVAL"]).zfill(4)
    eta = int(arrival[:2]) * 60 + int(arrival[2:]) + departure
    return (0 if 15 < weather < 50 and 0 < departure < 90 else 1, abs(eta - 840), item["sourceRow"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_directory", type=Path)
    args = parser.parse_args()
    source_airports = args.source_directory / "airports.csv"
    source_runways = args.source_directory / "runways.csv"
    with source_airports.open(newline="", encoding="utf-8") as handle:
        locations = list(csv.DictReader(handle))
    with source_runways.open(newline="", encoding="utf-8") as handle:
        runway_rows = list(csv.DictReader(handle))
    runways_by_ident = defaultdict(list)
    for row in runway_rows:
        endpoints = [number(row.get(key)) for key in (
            "le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg"
        )]
        if any(value is None for value in endpoints):
            continue
        if not all(-90 <= endpoints[index] <= 90 for index in (0, 2)):
            continue
        if not all(-180 <= endpoints[index] <= 180 for index in (1, 3)):
            continue
        runways_by_ident[row["airport_ident"]].append({
            "id": row["id"], "lowIdent": row["le_ident"], "highIdent": row["he_ident"],
            "start": endpoints[:2], "end": endpoints[2:],
            "lengthFt": number(row["length_ft"]), "widthFt": number(row["width_ft"]),
            "surface": row["surface"], "closedInSource": row["closed"] == "1",
        })

    with (ROOT / "data/airports.csv").open(newline="") as handle:
        original_airports = list(csv.DictReader(handle))
    arrivals, departures = Counter(), Counter()
    heaps = defaultdict(list)
    with (ROOT / "data/flights.csv").open(newline="") as handle:
        for row_number, row in enumerate(csv.DictReader(handle), 2):
            departures[row["ORIGIN_AIRPORT"]] += 1
            eligible = (number(row.get("WEATHER_DELAY")) or 0) > 15 or (number(row.get("LATE_AIRCRAFT_DELAY")) or 0) > 20
            if not eligible or row["CANCELLED"] != "0" or row["DIVERTED"] != "0":
                continue
            code = row["DESTINATION_AIRPORT"]
            arrivals[code] += 1
            item = {"sourceRow": row_number, "record": row}
            entry = (*(-value for value in example_order(item)), item)
            if len(heaps[code]) < 30:
                heapq.heappush(heaps[code], entry)
            elif entry > heaps[code][0]:
                heapq.heapreplace(heaps[code], entry)

    limits = {row["IATA_CODE"]: row for row in json.loads((ROOT / "data/operational-constraints.json").read_text())["airport_capacity"]}
    legacy = json.loads((ROOT / "data/flights-index.json").read_text())
    airports = []
    for original in original_airports:
        code = original["IATA_CODE"]
        latitude, longitude = number(original["LATITUDE"]), number(original["LONGITUDE"])
        matches = [row for row in locations if row["iata_code"] == code or row["ident"] == f"K{code}" or row.get("local_code") == code and row["iso_country"] == "US"]
        def match_order(row):
            distance = 0
            if latitude is not None and longitude is not None:
                distance = (float(row["latitude_deg"]) - latitude) ** 2 + (float(row["longitude_deg"]) - longitude) ** 2
            return (distance, row["type"] == "closed", row["iata_code"] != code)
        matched = min(matches, key=match_order) if matches else None
        if latitude is None or longitude is None:
            if not matched:
                raise ValueError(f"No coordinates found for {code}")
            latitude, longitude = float(matched["latitude_deg"]), float(matched["longitude_deg"])
        runways = runways_by_ident[matched["ident"]] if matched else []
        samples = sorted((entry[-1] for entry in heaps[code]), key=example_order)
        if code == "JFK":
            samples = legacy["records"]
        airports.append({
            "code": code, "name": original["AIRPORT"], "city": original["CITY"],
            "state": original["STATE"], "country": original["COUNTRY"],
            "latitude": latitude, "longitude": longitude,
            "coordinateSource": "organizer airports.csv" if original["LATITUDE"] and original["LONGITUDE"] else "OurAirports",
            "ident": matched["ident"] if matched else None,
            "currentName": matched["name"] if matched else None,
            "runways": sorted(runways, key=lambda runway: (-(runway["lengthFt"] or 0), runway["id"])),
            "arrivalCount": arrivals[code], "departureCount": departures[code],
            "capacity": limits[code], "records": samples,
        })
    manifest = {
        "schemaVersion": 1,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "sources": [{"name": "OurAirports", "url": SOURCE + path.name,
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                     "license": "Public Domain"} for path in (source_airports, source_runways)],
        "flightDatasetSha256": legacy["sha256"],
        "notes": ["Map data is a current source snapshot; flight examples are historical 2015 records.",
                  "Runway geometry is geographic context, not a source of live runway availability.",
                  "No OpenStreetMap tiles are bundled or prefetched."],
        "airports": airports,
    }
    destination = ROOT / "data/airport-catalog.json"
    destination.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print(f"{len(airports)} airports; {sum(bool(a['runways']) for a in airports)} with runway coordinates; "
          f"{sum(len(a['records']) for a in airports)} historical examples; {destination.stat().st_size:,} bytes.")
    print("Missing runway geometry:", ", ".join(a["code"] for a in airports if not a["runways"]) or "none")


if __name__ == "__main__":
    main()
