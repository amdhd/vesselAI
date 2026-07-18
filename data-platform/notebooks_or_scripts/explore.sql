-- ============================================================================
-- explore.sql  —  Poke at the RAW bronze layer and FIND the mess yourself.
--
-- The point of bronze is that nothing is cleaned yet, so every quality problem
-- is still visible. Run these before Phase 2 (silver). Each query below maps to
-- a specific cleaning rule we'll write in the silver model, so you can see the
-- "before" with your own eyes and know *why* each rule exists.
--
-- HOW TO RUN (pick one):
--   A) DuckDB CLI (nicest):   brew install duckdb
--                             duckdb data/vesselmind.duckdb ".read notebooks_or_scripts/explore.sql"
--   B) With the project venv (no extra install):
--                             ./.venv/bin/python -c "import duckdb; \
--                               [print(r) for r in duckdb.connect('data/vesselmind.duckdb').sql(open('notebooks_or_scripts/explore.sql').read()).fetchall()]"
--      (the venv path is easiest run statement-by-statement; the CLI is smoother
--       for a whole file — see README.)
--
-- Remember: in bronze EVERY column is TEXT (VARCHAR). That's why we use
-- TRY_CAST below — it turns un-parseable text into NULL instead of erroring,
-- which is exactly how we detect bad values.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- QUERY 0 — Sanity check: how much data, how many vessels, what time span?
-- Establishes the baseline before we go looking for problems.
-- ----------------------------------------------------------------------------
SELECT
    count(*)                              AS total_rows,
    count(DISTINCT MMSI)                  AS distinct_mmsi,
    min(BaseDateTime)                     AS first_timestamp_text,
    max(BaseDateTime)                     AS last_timestamp_text
FROM bronze.ais_positions_raw;


-- ----------------------------------------------------------------------------
-- QUERY 1 — DUPLICATE PINGS.
-- A vessel can only be in one place at one instant, so the same
-- (MMSI, BaseDateTime) should appear at most once. AIS transmits redundantly
-- and receivers log repeats, so duplicates are common.
--   -> Silver will DEDUPLICATE on (MMSI, BaseDateTime).
-- This query shows how many timestamp-keys are duplicated and how many extra
-- rows that represents.
-- ----------------------------------------------------------------------------
WITH dupes AS (
    SELECT MMSI, BaseDateTime, count(*) AS n
    FROM bronze.ais_positions_raw
    GROUP BY MMSI, BaseDateTime
    HAVING count(*) > 1
)
SELECT
    count(*)            AS duplicated_keys,       -- how many (mmsi,time) combos repeat
    sum(n)              AS rows_in_those_groups,  -- total rows involved
    sum(n) - count(*)   AS redundant_rows         -- how many we'd drop as duplicates
FROM dupes;


-- ----------------------------------------------------------------------------
-- QUERY 2 — IMPOSSIBLE / MISSING COORDINATES.
-- Valid latitude is -90..90, valid longitude is -180..180. Anything else is a
-- bad fix. "0/0" (null island) is the GPS default when a device has no lock —
-- it's a real point in the Atlantic, so it looks valid but isn't.
--   -> Silver will KEEP only rows with lat in [-90,90] AND lon in [-180,180],
--      and drop the 0/0 sentinel.
-- TRY_CAST returns NULL for empty/garbage text, which we count as invalid too.
-- ----------------------------------------------------------------------------
SELECT
    count(*) FILTER (WHERE TRY_CAST(LAT AS DOUBLE) IS NULL
                        OR TRY_CAST(LON AS DOUBLE) IS NULL)          AS non_numeric_or_empty,
    count(*) FILTER (WHERE TRY_CAST(LAT AS DOUBLE) NOT BETWEEN -90 AND 90)   AS lat_out_of_range,
    count(*) FILTER (WHERE TRY_CAST(LON AS DOUBLE) NOT BETWEEN -180 AND 180) AS lon_out_of_range,
    count(*) FILTER (WHERE TRY_CAST(LAT AS DOUBLE) = 0
                       AND TRY_CAST(LON AS DOUBLE) = 0)              AS null_island_0_0
FROM bronze.ais_positions_raw;

-- (Optional) eyeball a few of the offending rows:
-- SELECT MMSI, BaseDateTime, LAT, LON
-- FROM bronze.ais_positions_raw
-- WHERE TRY_CAST(LAT AS DOUBLE) NOT BETWEEN -90 AND 90
--    OR TRY_CAST(LON AS DOUBLE) NOT BETWEEN -180 AND 180
--    OR (TRY_CAST(LAT AS DOUBLE) = 0 AND TRY_CAST(LON AS DOUBLE) = 0)
-- LIMIT 10;


-- ----------------------------------------------------------------------------
-- QUERY 3 — MISSING / INVALID VESSEL IDENTIFIER (MMSI).
-- MMSI is the vessel's ID and the backbone of everything downstream (it's how
-- we group pings into tracks and join to vessel attributes). A row with no MMSI
-- is unusable. A valid MMSI is 9 digits.
--   -> Silver will DROP rows where MMSI is missing/blank.
-- ----------------------------------------------------------------------------
SELECT
    count(*) FILTER (WHERE MMSI IS NULL OR trim(MMSI) = '')          AS missing_mmsi,
    count(*) FILTER (WHERE MMSI IS NOT NULL AND trim(MMSI) <> ''
                       AND NOT regexp_matches(MMSI, '^[0-9]{9}$'))   AS malformed_mmsi_not_9_digits,
    count(*)                                                          AS total_rows
FROM bronze.ais_positions_raw;


-- ----------------------------------------------------------------------------
-- QUERY 4 (bonus) — COMPLETENESS: how often are key attributes blank?
-- Not everything blank is "wrong" (Class B vessels and fishing boats often have
-- no IMO or name), but knowing the null rate tells us which columns are safe to
-- rely on in gold. This informs design, not a hard cleaning rule.
-- ----------------------------------------------------------------------------
SELECT
    round(100.0 * count(*) FILTER (WHERE VesselName IS NULL OR trim(VesselName) = '') / count(*), 1) AS pct_missing_name,
    round(100.0 * count(*) FILTER (WHERE IMO        IS NULL OR trim(IMO)        = '') / count(*), 1) AS pct_missing_imo,
    round(100.0 * count(*) FILTER (WHERE SOG        IS NULL OR trim(SOG)        = '') / count(*), 1) AS pct_missing_sog,
    round(100.0 * count(*) FILTER (WHERE VesselType IS NULL OR trim(VesselType) = '') / count(*), 1) AS pct_missing_vesseltype
FROM bronze.ais_positions_raw;


-- ============================================================================
-- GOLD LAYER (Phase 3) — the analytics-ready star schema + business model.
-- These read from gold.* (built by dbt). Run `dbt build` first.
-- ============================================================================

-- QUERY 5 — the vessel dimension: one descriptive row per vessel.
SELECT mmsi, vessel_name, vessel_type_desc, transceiver_class, length_m
FROM gold.dim_vessel
ORDER BY vessel_name;

-- QUERY 6 — daily activity leaderboard. Note how we JOIN the fact to the
-- dimension to turn an MMSI into a readable name/type — that's the whole point
-- of a star schema: measures in the fact, context in the dimension.
SELECT
    d.vessel_name,
    d.vessel_type_desc,
    f.activity_date,
    f.ping_count,
    f.avg_speed_knots,
    f.distance_nm
FROM gold.fct_vessel_daily f
JOIN gold.dim_vessel d USING (mmsi)
ORDER BY f.distance_nm DESC;

-- QUERY 7 — the business answer: who idled, where, and for how long?
-- (speed at/below the idle threshold for an extended, continuous period)
SELECT
    d.vessel_name,
    d.vessel_type_desc,
    i.idle_start,
    i.idle_end,
    i.idle_minutes,
    i.avg_lat,
    i.avg_lon
FROM gold.gold_vessel_idling i
JOIN gold.dim_vessel d USING (mmsi)
ORDER BY i.idle_minutes DESC;
