-- fct_vessel_daily.ping_count must add up to the raw position count in silver,
-- vessel by vessel.
--
-- WHY THIS IS A TEST AND NOT JUST TRUE. The analytics API's summary reports
-- "position reports" as sum(ping_count) over this fact table instead of
-- count(*) over silver (data-platform/api/main.py). That is the whole point: a
-- scan of every raw ping per request (millions of rows a day at NOAA scale)
-- becomes a read of one row per vessel per day. It is only correct while the
-- two agree, so this makes that an invariant the build enforces. If a future
-- change to fct_vessel_daily filtered pings out (deduplication, a validity
-- rule), this fails the build instead of letting the KPI quietly drift.
--
-- Returns the vessels where the counts differ; dbt treats any row as a failure.

with silver_counts as (
    select mmsi, count(*) as pings
    from {{ ref('silver_ais_positions') }}
    group by mmsi
),

fact_counts as (
    select mmsi, sum(ping_count) as pings
    from {{ ref('fct_vessel_daily') }}
    group by mmsi
)

select
    coalesce(s.mmsi, f.mmsi) as mmsi,
    s.pings as silver_pings,
    f.pings as fact_pings
from silver_counts s
full outer join fact_counts f on f.mmsi = s.mmsi
where s.pings is distinct from f.pings
