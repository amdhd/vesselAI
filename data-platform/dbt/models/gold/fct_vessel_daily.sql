-- fct_vessel_daily  —  the FACT: one row per vessel per day, measuring WHAT
-- happened that day. Grain = (mmsi, activity_date). Every column below is either
-- the grain key or an additive/summary measure. To describe the vessel itself,
-- join this to dim_vessel on mmsi.
--
-- The interesting measure is distance_nm: AIS gives us positions, not distance,
-- so we estimate it by summing the great-circle hop between each ping and the
-- previous one (same vessel, same day). See macros/haversine_nm.sql for caveats.

with positions as (

    select
        mmsi,
        event_time,
        cast(event_time as date) as activity_date,
        latitude,
        longitude,
        sog_knots
    from {{ ref('silver_ais_positions') }}

),

with_previous as (

    -- Pull each ping's previous position WITHIN the same vessel-day, so we can
    -- measure the leg travelled since the last ping. Partitioning by day means
    -- the first ping of each day has no previous point (prev_* is NULL) and
    -- therefore contributes zero distance — no phantom leg across midnight.
    select
        positions.*,
        lag(latitude)  over w as prev_lat,
        lag(longitude) over w as prev_lon
    from positions
    window w as (partition by mmsi, activity_date order by event_time)

),

segments as (

    select
        *,
        case
            when prev_lat is not null
            then {{ haversine_nm('prev_lat', 'prev_lon', 'latitude', 'longitude') }}
            else 0
        end as segment_nm
    from with_previous

)

select
    mmsi,
    activity_date,
    count(*)                            as ping_count,
    round(avg(sog_knots), 2)            as avg_speed_knots,
    round(max(sog_knots), 2)            as max_speed_knots,
    round(sum(segment_nm), 2)           as distance_nm,          -- estimated distance travelled
    min(event_time)                     as first_ping_time,
    max(event_time)                     as last_ping_time,
    -- position at the first / last ping of the day (arg_min/arg_max by time)
    arg_min(latitude,  event_time)      as first_lat,
    arg_min(longitude, event_time)      as first_lon,
    arg_max(latitude,  event_time)      as last_lat,
    arg_max(longitude, event_time)      as last_lon
from segments
group by mmsi, activity_date
