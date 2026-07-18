"""
VesselMind — vessel-activity dashboard (Phase 4).

Reads ONLY the gold layer (dim_vessel, fct_vessel_daily, gold_vessel_idling) —
never bronze or silver. Gold is already aggregated and tiny, so loading it into
pandas here is fine even when the raw feed is millions of rows: the heavy lifting
happened in DuckDB/dbt, and the dashboard just displays the results.

Run:  streamlit run dashboard.py
"""

from pathlib import Path

import duckdb
import streamlit as st

# Resolve the warehouse relative to THIS file, so the app runs from any cwd.
DB_PATH = Path(__file__).resolve().parent / "data" / "vesselmind.duckdb"

st.set_page_config(page_title="VesselMind — Vessel Activity", page_icon="🚢", layout="wide")


@st.cache_resource
def get_connection():
    # read_only: the dashboard never writes, so it can safely share the DuckDB
    # file with the pipeline and multiple viewers.
    return duckdb.connect(str(DB_PATH), read_only=True)


@st.cache_data
def query(sql: str):
    return get_connection().execute(sql).df()


st.title("🚢 VesselMind — Vessel Activity")
st.caption("Gold layer only · dim_vessel · fct_vessel_daily · gold_vessel_idling")

if not DB_PATH.exists():
    st.error(
        "Warehouse not found. Build it first:\n\n"
        "```\npython ingestion/load_bronze.py\ncd dbt && dbt build --profiles-dir .\n```"
    )
    st.stop()

# --- Load gold (facts joined to the vessel dimension for readable names) ---
vessels = query("SELECT * FROM gold.dim_vessel")
daily = query(
    """
    SELECT d.vessel_name, d.vessel_type_desc, f.*
    FROM gold.fct_vessel_daily f
    JOIN gold.dim_vessel d USING (mmsi)
    """
)
idling = query(
    """
    SELECT d.vessel_name, d.vessel_type_desc,
           i.idle_start, i.idle_end, i.idle_minutes, i.idle_pings, i.avg_lat, i.avg_lon
    FROM gold.gold_vessel_idling i
    JOIN gold.dim_vessel d USING (mmsi)
    ORDER BY i.idle_minutes DESC
    """
)

# --- Sidebar filter ---
types = sorted(vessels["vessel_type_desc"].unique())
chosen = st.sidebar.multiselect("Vessel type", types, default=types)
daily_f = daily[daily["vessel_type_desc"].isin(chosen)]
idling_f = idling[idling["vessel_type_desc"].isin(chosen)]

if daily_f.empty:
    st.warning("No vessels match the selected types.")
    st.stop()

# --- KPI row ---
k1, k2, k3, k4 = st.columns(4)
k1.metric("Vessels", daily_f["mmsi"].nunique())
k2.metric("Position reports", f"{int(daily_f['ping_count'].sum()):,}")
k3.metric("Distance travelled (nm)", f"{daily_f['distance_nm'].sum():,.0f}")
k4.metric("Idle episodes", len(idling_f))

# --- Map: each vessel's latest known position ---
st.subheader("Latest vessel positions")
latest = (
    daily_f.sort_values("last_ping_time")
    .groupby("vessel_name", as_index=False)
    .last()
    .rename(columns={"last_lat": "latitude", "last_lon": "longitude"})
)
st.map(latest[["latitude", "longitude"]], zoom=6)

# --- Chart + table side by side ---
left, right = st.columns([1, 1])
with left:
    st.subheader("Distance travelled by vessel (nm)")
    by_vessel = (
        daily_f.groupby("vessel_name", as_index=False)["distance_nm"].sum()
        .sort_values("distance_nm", ascending=False)
        .set_index("vessel_name")
    )
    st.bar_chart(by_vessel)
with right:
    st.subheader("⚓ Idling report")
    st.caption("Vessels stopped (near-zero speed) for extended periods — port-congestion signal.")
    st.dataframe(idling_f, use_container_width=True, hide_index=True)
