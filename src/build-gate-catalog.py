"""Build airport-specific gate coordinates from an OpenStreetMap Overpass export.

Usage: python3 src/build-gate-catalog.py /path/to/gates.json
Query: data/map-sources/gates-query.overpassql
This extracts mapped passenger gates; missing locations are never invented.
"""
import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUERY = ROOT / "data/map-sources/gates-query.overpassql"


def natural_order(value):
    return tuple((0, int(part)) if part.isdigit() else (1, part.casefold())
                 for part in re.split(r"(\d+)", value))


def build(source_file):
    raw = source_file.read_bytes()
    response = json.loads(raw)
    if response.get("remark"):
        raise ValueError(f"Incomplete Overpass response: {response['remark']}")
    catalog_path = ROOT / "data/airport-catalog.json"
    airports = json.loads(catalog_path.read_text())["airports"]
    grouped = {airport["code"]: [] for airport in airports}
    seen = set()
    for element in response.get("elements", []):
        tags = element.get("tags", {})
        if element.get("type") != "node" or tags.get("aeroway") != "gate":
            continue
        latitude, longitude = element.get("lat"), element.get("lon")
        if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
            continue
        if not math.isfinite(latitude) or not math.isfinite(longitude) or abs(latitude) > 90 or abs(longitude) > 180:
            continue
        identifier = f"node/{element['id']}"
        if identifier in seen:
            continue
        seen.add(identifier)
        def distance(airport):
            return math.hypot((airport["latitude"] - latitude) * 111320,
                              (airport["longitude"] - longitude) * 111320 * math.cos(math.radians(latitude)))
        airport = min(airports, key=distance)
        separation = distance(airport)
        if separation > 5000:
            continue
        grouped[airport["code"]].append({
            "osmId": identifier, "latitude": latitude, "longitude": longitude,
            "ref": tags.get("ref"), "name": tags.get("name"), "terminal": tags.get("terminal"),
            "sourceUrl": f"https://www.openstreetmap.org/{identifier}",
            "distanceFromAirportM": round(separation),
        })
    for gates in grouped.values():
        gates.sort(key=lambda gate: (not bool(gate["ref"]), natural_order(gate["terminal"] or ""),
                                     natural_order(gate["ref"] or gate["name"] or ""), gate["osmId"]))
    output = {
        "schemaVersion": 1,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "osmTimestamp": response.get("osm3s", {}).get("timestamp_osm_base"),
        "source": {"name": "OpenStreetMap passenger gates", "url": "https://overpass-api.de/api/interpreter",
                   "license": "ODbL-1.0", "licenseUrl": "https://www.openstreetmap.org/copyright",
                   "sha256": hashlib.sha256(raw).hexdigest(),
                   "querySha256": hashlib.sha256(QUERY.read_bytes()).hexdigest()},
        "airportCatalogSha256": hashlib.sha256(catalog_path.read_bytes()).hexdigest(),
        "association": "Nearest organizer airport reference point within 5,000 metres; unique OSM node IDs.",
        "notes": ["These are mapped passenger gate points, not aircraft parking positions or live gate availability.",
                  "Scenario gate aliases are assigned to distinct source nodes in stable natural-reference order.",
                  "Unmapped aliases have no coordinates and must not be drawn on the geographic map."],
        "airports": grouped,
    }
    destination = ROOT / "data/airport-gates.json"
    destination.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"{sum(len(gates) for gates in grouped.values()):,} source gate nodes; "
          f"{sum(bool(gates) for gates in grouped.values())}/{len(grouped)} airports with mapped gates.")
    print(f"Saved {destination.stat().st_size:,} bytes to {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    build(parser.parse_args().source)
