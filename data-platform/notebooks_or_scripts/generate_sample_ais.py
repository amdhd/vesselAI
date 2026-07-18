"""
generate_sample_ais.py  —  OPTIONAL demo-data generator (scalable).

Why this exists
---------------
The real pipeline runs on NOAA MarineCadastre AIS daily files, which are
5-12 MILLION rows each (see README for the download link). Those are big and
must be downloaded by hand, which makes the repo awkward to try out.

So this script writes a synthetic CSV using the *exact same column schema* as
the real NOAA file, with the kinds of "mess" you find in real AIS feeds
(duplicate pings, impossible coordinates, GPS "null island" 0/0, missing MMSI).

It is SIZE-ADJUSTABLE. With no arguments it writes a small ~2.4k-row teaching
sample where the mess is easy to count. Crank up --vessels / --step-min and it
will happily emit millions of rows to demonstrate that the pipeline is not
toy-scale — the same loader + dbt models handle it unchanged.

It streams row-by-row (constant memory), so a multi-million-row file is fine on
a 16GB laptop, and it interleaves vessels by timestamp like a real feed.

Examples:
    # small teaching sample (default) -> data/raw/ais_sample.csv  (~2.4k rows)
    python notebooks_or_scripts/generate_sample_ais.py

    # ~1.5 million rows, to a separate file, to demo scale
    python notebooks_or_scripts/generate_sample_ais.py \
        --vessels 1000 --step-min 1 --out data/ais_large.csv

Uses the standard library only.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

# NOAA MarineCadastre AIS daily-file schema (2018-present format). Keeping these
# names identical to the real file is what lets the same loader work on both.
NOAA_COLUMNS = [
    "MMSI", "BaseDateTime", "LAT", "LON", "SOG", "COG", "Heading",
    "VesselName", "IMO", "CallSign", "VesselType", "Status",
    "Length", "Width", "Draft", "Cargo", "TransceiverClass",
]

# Named base vessels around the Houston Ship Channel / Galveston Bay. VesselType
# and Status use real AIS codes (70=cargo, 80=tanker, 52=tug, 30=fishing,
# 60=passenger; status 0=under way, 1=at anchor, 5=moored).
BASE_VESSELS = [
    # mmsi,     name,             imo,       callsign, vtype, lat,    lon,     cruise, status, len, wid, draft, cargo, tclass
    ("366999001", "GULF VOYAGER",   "9134221", "WDA2911", "70", 29.73, -94.98, 12.5, "0", "180", "28", "9.2", "70", "A"),
    ("367123450", "TEXAS STAR",     "9256677", "WDB5522", "80", 29.68, -94.91, 10.0, "0", "250", "44", "12.5", "80", "A"),
    ("368080720", "BAYOU TUG 7",    "",        "WDC7003", "52", 29.75, -95.01,  6.0, "0", "32",  "11", "4.0", "", "A"),
    ("367777123", "MISS GALVESTON", "",        "WDD1180", "30", 29.31, -94.77,  4.5, "0", "24",  "8",  "3.1", "", "B"),
    ("366515000", "PORT PILOT II",  "9051234", "WDE4410", "60", 29.66, -94.88,  9.0, "0", "45",  "12", "3.8", "60", "A"),
    ("367011500", "ANCHOR QUEEN",   "9330012", "WDF2277", "80", 29.52, -94.70,  0.2, "1", "230", "40", "13.0", "80", "A"),
    ("368112900", "HARBOR MOOR",    "",        "WDG9001", "52", 29.74, -95.00,  0.0, "5", "30",  "10", "3.5", "", "A"),
    ("367445090", "LONE FISHER",    "",        "",        "30", 29.24, -94.65,  5.5, "0", "20",  "7",  "2.8", "", "B"),
]

START = datetime(2024, 1, 15, 0, 0, 0)

# Per-clean-row probabilities of ALSO emitting a dirty row. Small, so at the
# default size they total ~64 dirty rows (easy to find); at millions of rows
# they scale proportionally into realistic quantities.
P_DUP = 0.013          # exact duplicate transmission
P_BADCOORD = 0.005     # impossible latitude/longitude
P_NULLISLAND = 0.004   # GPS default 0/0
P_MISSING_MMSI = 0.005 # blank vessel id


def build_fleet(n_vessels: int) -> list[tuple]:
    """Return n vessel profiles. The first 8 are the named base vessels; beyond
    that we synthesize more by cloning a base profile with a fresh 9-digit MMSI
    and a jittered start position, so we can scale the fleet to any size."""
    fleet = list(BASE_VESSELS[:n_vessels])
    for i in range(len(BASE_VESSELS), n_vessels):
        base = BASE_VESSELS[i % len(BASE_VESSELS)]
        mmsi = str(367_000_000 + i)  # 9 digits, US region prefix
        lat = round(28.5 + random.random() * 1.6, 4)   # spread across the bay/approaches
        lon = round(-95.4 + random.random() * 1.2, 4)
        cruise = round(random.uniform(0.0, 14.0), 1)
        name = f"SYNTH VESSEL {i:04d}" if random.random() > 0.15 else ""  # some blanks, like Class B
        fleet.append((mmsi, name, base[2], "", base[4], lat, lon, cruise,
                      base[8], base[9], base[10], base[11], base[12], base[13]))
    return fleet


def knots_to_deg(sog_knots: float, minutes: float) -> float:
    """Distance in degrees covered at `sog_knots` over `minutes` (rough)."""
    return sog_knots * (minutes / 60.0) / 60.0


def clean_row(v_state: dict, v: tuple, ts: datetime, step_min: float) -> list[str]:
    """Advance one vessel's position by one step and return its AIS row."""
    (mmsi, name, imo, callsign, vtype, _lat0, _lon0, cruise, status,
     length, width, draft, cargo, tclass) = v
    lat, lon, heading = v_state["lat"], v_state["lon"], v_state["heading"]

    sog = max(0.0, random.gauss(cruise, 1.2)) if cruise > 1 else max(0.0, random.gauss(cruise, 0.15))
    heading = (heading + random.uniform(-15, 15)) % 360
    d = knots_to_deg(sog, step_min)
    lat += d * math.cos(math.radians(heading))
    lon += d * math.sin(math.radians(heading)) / max(0.1, math.cos(math.radians(lat)))
    v_state["lat"], v_state["lon"], v_state["heading"] = lat, lon, heading

    return [
        mmsi, ts.strftime("%Y-%m-%dT%H:%M:%S"),
        f"{lat:.5f}", f"{lon:.5f}", f"{sog:.1f}",
        f"{(heading + random.uniform(-5, 5)) % 360:.1f}", str(int(heading)),
        name, imo, callsign, vtype, status, length, width, draft, cargo, tclass,
    ]


def main() -> None:
    default_out = Path(__file__).resolve().parents[1] / "data" / "raw" / "ais_sample.csv"
    ap = argparse.ArgumentParser(description="Generate synthetic NOAA-schema AIS data.")
    ap.add_argument("--vessels", type=int, default=8, help="fleet size (default 8)")
    ap.add_argument("--days", type=float, default=1.0, help="days to simulate (default 1)")
    ap.add_argument("--step-min", type=float, default=5.0, help="minutes between pings (default 5)")
    ap.add_argument("--out", default=str(default_out), help="output CSV path")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    fleet = build_fleet(args.vessels)
    steps = max(1, int(args.days * 24 * 60 / args.step_min))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Per-vessel mutable position state (so tracks are continuous across steps).
    state = {v[0]: {"lat": v[5], "lon": v[6], "heading": random.uniform(0, 359)} for v in fleet}

    clean, dirty = 0, 0
    with out.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(NOAA_COLUMNS)
        # Outer loop = time, inner = vessels, so vessels interleave by timestamp
        # (like a real feed) and we never hold more than one row in memory.
        for i in range(steps):
            ts = START + timedelta(minutes=i * args.step_min)
            for v in fleet:
                row = clean_row(state[v[0]], v, ts, args.step_min)
                w.writerow(row); clean += 1

                # Sprinkle in dirty rows (each maps to a rule silver will apply).
                x = random.random()
                if x < P_DUP:
                    w.writerow(row); dirty += 1                                  # exact duplicate
                elif x < P_DUP + P_BADCOORD:
                    bad = list(row)
                    bad[2] = random.choice(["91.0", "99.99", ""])                # impossible LAT
                    bad[3] = random.choice(["-181.0", "200.0", ""])              # impossible LON
                    w.writerow(bad); dirty += 1
                elif x < P_DUP + P_BADCOORD + P_NULLISLAND:
                    ni = list(row); ni[2], ni[3] = "0.0", "0.0"                  # null island
                    w.writerow(ni); dirty += 1
                elif x < P_DUP + P_BADCOORD + P_NULLISLAND + P_MISSING_MMSI:
                    nm = list(row); nm[0] = ""                                   # missing MMSI
                    w.writerow(nm); dirty += 1

    total = clean + dirty
    size_mb = out.stat().st_size / 1e6
    print(f"Wrote {total:,} rows ({clean:,} clean + {dirty:,} injected dirty) "
          f"from {len(fleet)} vessels over {args.days} day(s) @ {args.step_min}-min pings")
    print(f"  -> {out}  ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
