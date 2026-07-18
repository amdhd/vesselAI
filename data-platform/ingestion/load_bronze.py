"""
load_bronze.py  —  Land raw AIS CSV into the DuckDB "bronze" layer, untouched.

WHAT THIS DOES (and why it's designed this way)
-----------------------------------------------
This is the first stop in a medallion architecture: bronze -> silver -> gold.
Bronze's ONE job is to land the source data losslessly, so we always have a
faithful copy of what arrived, before anyone cleans or reshapes it.

Three deliberate design decisions worth being able to explain:

1) Everything is loaded as TEXT (all_varchar=true).
   Real AIS files contain impossible values: latitude 91, empty MMSI, "0/0"
   coordinates. If we let DuckDB guess column types on load, it would silently
   turn those bad values into NULLs (or fail the load). Bronze must keep the
   mess *as-is* so we can see it and decide what to do in silver. Typing is a
   silver concern, not a bronze concern.

2) DuckDB reads the CSV directly from disk — we never load it into pandas.
   DuckDB streams the file and can process data larger than RAM. On a 16GB
   laptop that means a full NOAA daily file (100s of MB) loads fine, where a
   pandas read_csv might blow up memory.

3) We add two provenance columns (_source_file, _ingested_at) but change
   nothing else. That's lineage, not cleaning: months later we can still tell
   which file and load produced any row. Every original column is preserved
   byte-for-byte.

Re-running is safe: the bronze table is REPLACED each run (idempotent), so the
warehouse state depends only on what's currently in data/raw/.

Usage:
    python ingestion/load_bronze.py                 # loads all CSVs in data/raw/
    python ingestion/load_bronze.py --csv path.csv  # load one specific file
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from glob import glob
from pathlib import Path

import duckdb

# Project layout: this file lives in <root>/ingestion/, so the root is one up.
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "vesselmind.duckdb"
DEFAULT_RAW_GLOB = str(ROOT / "data" / "raw" / "*.csv")

BRONZE_SCHEMA = "bronze"
BRONZE_TABLE = "ais_positions_raw"


def find_csv_files(csv_arg: str | None) -> list[str]:
    """Resolve which CSV file(s) to load. Either an explicit --csv, or every
    CSV sitting in data/raw/ (so dropping the real NOAA file 'just works')."""
    if csv_arg:
        p = Path(csv_arg)
        if not p.exists():
            sys.exit(f"ERROR: file not found: {p}")
        return [str(p)]

    files = sorted(glob(DEFAULT_RAW_GLOB))
    if not files:
        sys.exit(
            "ERROR: no CSV files found in data/raw/.\n"
            "  - For a quick demo:   python notebooks_or_scripts/generate_sample_ais.py\n"
            "  - For real data:      download a NOAA AIS daily file (see README) into data/raw/"
        )
    return files


def sql_file_list(files: list[str]) -> str:
    """Build a safe SQL list literal like ['a.csv','b.csv'] with quotes escaped,
    so we can pass multiple files to DuckDB's read_csv() in one shot."""
    escaped = [f.replace("'", "''") for f in files]
    return "[" + ", ".join(f"'{f}'" for f in escaped) + "]"


def load_bronze(files: list[str], db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    try:
        con.execute(f"CREATE SCHEMA IF NOT EXISTS {BRONZE_SCHEMA};")

        file_list = sql_file_list(files)
        # all_varchar   -> keep every value as raw text (no silent type coercion)
        # header=true   -> first row is the NOAA column names
        # filename=true -> DuckDB adds a 'filename' column = provenance for free
        # union_by_name -> if several daily files differ in column order, align them
        con.execute(
            f"""
            CREATE OR REPLACE TABLE {BRONZE_SCHEMA}.{BRONZE_TABLE} AS
            SELECT
                * EXCLUDE (filename),           -- all original NOAA columns, untouched
                filename        AS _source_file,-- which file this row came from
                now()           AS _ingested_at -- when we landed it
            FROM read_csv(
                {file_list},
                all_varchar = true,
                header      = true,
                filename    = true,
                union_by_name = true
            );
            """
        )

        # Everything below is just human-friendly reporting — no data is changed.
        n_rows = con.execute(
            f"SELECT count(*) FROM {BRONZE_SCHEMA}.{BRONZE_TABLE}"
        ).fetchone()[0]
        cols = con.execute(
            f"SELECT column_name, data_type FROM information_schema.columns "
            f"WHERE table_schema = '{BRONZE_SCHEMA}' AND table_name = '{BRONZE_TABLE}' "
            f"ORDER BY ordinal_position"
        ).fetchall()

        print("=" * 64)
        print("BRONZE LOAD COMPLETE")
        print("=" * 64)
        print(f"Database : {db_path}")
        print(f"Table    : {BRONZE_SCHEMA}.{BRONZE_TABLE}")
        print(f"Rows     : {n_rows:,}")
        print(f"Files    : {len(files)}")
        for f in files:
            print(f"           - {f}")
        print(f"\nColumns  : {len(cols)} (note: every source column is VARCHAR = raw text)")
        for name, dtype in cols:
            marker = "  <- provenance (added by loader)" if name.startswith("_") else ""
            print(f"           {name:<18} {dtype}{marker}")

        print("\nSample (first 5 rows, selected columns):")
        preview = con.execute(
            f"SELECT MMSI, BaseDateTime, LAT, LON, SOG, VesselName "
            f"FROM {BRONZE_SCHEMA}.{BRONZE_TABLE} LIMIT 5"
        ).fetchall()
        for row in preview:
            print(f"           {row}")

        print("\nNext: explore the raw data and find the mess before cleaning ->")
        print("      notebooks_or_scripts/explore.sql")
        print("=" * 64)
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Load raw AIS CSV into the DuckDB bronze layer.")
    ap.add_argument("--csv", help="Path to a specific CSV. Default: all CSVs in data/raw/.")
    ap.add_argument("--db", default=str(DEFAULT_DB), help="Path to the DuckDB file.")
    args = ap.parse_args()

    files = find_csv_files(args.csv)
    print(f"Loading {len(files)} file(s) into bronze at {datetime.now(timezone.utc).isoformat(timespec='seconds')} ...")
    load_bronze(files, Path(args.db))


if __name__ == "__main__":
    main()
