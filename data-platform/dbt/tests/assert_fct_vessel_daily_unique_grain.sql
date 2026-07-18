-- Singular test: fct_vessel_daily must have exactly one row per (mmsi,
-- activity_date) — that IS its declared grain. Any returned row means the grain
-- is broken (double-counting risk). Passes when it returns zero rows.
select
    mmsi,
    activity_date,
    count(*) as n_rows
from {{ ref('fct_vessel_daily') }}
group by mmsi, activity_date
having count(*) > 1
