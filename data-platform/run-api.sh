#!/usr/bin/env bash
#
# Start the VesselMind Analytics API — the read-only FastAPI service that serves
# the DuckDB "gold" layer to the React app's Fleet Analytics page.
#
#   Data flow:  NOAA CSV -> bronze -> silver -> gold (DuckDB)  ->  THIS API  ->  React
#
# Usage:
#   ./run-api.sh                 # serve on :8000 (the port the React app expects)
#   PORT=8080 ./run-api.sh       # serve on a custom port
#
# One-time prereqs (see README.md for detail):
#   * Python 3.10 venv at .venv/  (dbt-core has no wheels for newer Pythons)
#   * the built DuckDB warehouse at data/vesselmind.duckdb  (via the dbt build)
#
set -euo pipefail

# Run from the script's own directory so relative paths resolve no matter where
# it's invoked from.
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
VENV_UVICORN=".venv/bin/uvicorn"
DB_PATH="data/vesselmind.duckdb"

if [[ ! -x "$VENV_UVICORN" ]]; then
  echo "error: Python venv not found at .venv/ (looked for $VENV_UVICORN)" >&2
  echo "  create it first, e.g.:" >&2
  echo "    python3.10 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "error: DuckDB warehouse not found at $DB_PATH" >&2
  echo "  build it first:" >&2
  echo "    python ingestion/load_bronze.py" >&2
  echo "    (cd dbt && ../.venv/bin/dbt build --profiles-dir .)" >&2
  exit 1
fi

echo "Starting VesselMind Analytics API on http://localhost:${PORT}  (Ctrl-C to stop)"
# exec so uvicorn replaces this shell and receives Ctrl-C / SIGTERM directly.
exec "$VENV_UVICORN" api.main:app --port "$PORT"
