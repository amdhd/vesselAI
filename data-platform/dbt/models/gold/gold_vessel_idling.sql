-- gold_vessel_idling  —  the BUSINESS model: which vessels sat idle, and for
-- how long? Idling (engines on but barely moving — waiting for a berth, anchored
-- in a queue) burns fuel and signals port congestion, so operators want it
-- surfaced. Grain = one row per idle EPISODE.
--
-- "Idle" = speed at/below {{ var('idle_speed_knots') }} knots. An "episode" = a
-- run of consecutive idle pings lasting at least {{ var('idle_min_minutes') }}
-- minutes (a single slow ping isn't idling).
--
-- The core technique is "gaps and islands": we need to group consecutive idle
-- pings into runs. Trick: mark the first ping of each idle run (idle now, not
-- idle just before), then a running SUM of those markers gives every ping in
-- the same run an identical run_id.

with flagged as (

    select
        mmsi,
        event_time,
        latitude,
        longitude,
        sog_knots,
        case when sog_knots <= {{ var('idle_speed_knots') }} then 1 else 0 end as is_idle
    from {{ ref('silver_ais_positions') }}

),

run_starts as (

    select
        *,
        -- 1 exactly when an idle run BEGINS: this ping is idle and the previous
        -- ping (for this vessel) was not. coalesce handles the very first ping.
        case
            when is_idle = 1
             and coalesce(lag(is_idle) over (partition by mmsi order by event_time), 0) = 0
            then 1 else 0
        end as is_run_start
    from flagged

),

runs as (

    select
        *,
        -- Running total of run-starts = a stable id shared by all pings in a run.
        sum(is_run_start) over (partition by mmsi order by event_time) as run_id
    from run_starts

),

episodes as (

    select
        mmsi,
        run_id,
        min(event_time)        as idle_start,
        max(event_time)        as idle_end,
        count(*)               as idle_pings,
        round(avg(latitude), 5)  as avg_lat,
        round(avg(longitude), 5) as avg_lon,
        round(avg(sog_knots), 3) as avg_sog_knots
    from runs
    where is_idle = 1
    group by mmsi, run_id

)

select
    mmsi,
    idle_start,
    idle_end,
    date_diff('minute', idle_start, idle_end) as idle_minutes,
    idle_pings,
    avg_lat,
    avg_lon,
    avg_sog_knots
from episodes
-- keep only genuinely extended stops
where date_diff('minute', idle_start, idle_end) >= {{ var('idle_min_minutes') }}
order by idle_minutes desc
