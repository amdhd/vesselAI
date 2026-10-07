-- Singular test: an idle episode may not span a hole in the reporting.
--
-- gold_vessel_idling groups consecutive idle pings into episodes, where
-- "consecutive" has to mean adjacent in TIME. It used to mean adjacent in the
-- ordering, and the two differ exactly where it matters: a vessel that went
-- idle, stopped reporting for a day, then resumed idle has no non-idle ping
-- between the runs, so ordering alone merged them into a single episode
-- spanning the silence. 2,140 of 23,632 episodes were inflated that way, the
-- worst claiming 1,433 minutes of idling from 14 pings with a 23-hour hole in
-- the middle.
--
-- This reads the model's OUTPUT back and checks it against silver, rather than
-- re-deriving the episodes: re-deriving them with the same expression would
-- only prove the expression equals itself. For every episode, the idle pings
-- silver holds inside its span must be no more than
-- {{ var('idle_max_gap_minutes') }} minutes apart.
--
-- The first ping of each span has a NULL gap (there is no earlier ping inside
-- that episode) and is excluded; the boundary between two episodes is a real
-- run ending, not a gap within one.
--
-- Passes when it returns zero rows. Note when verifying this test by deleting
-- the gap guard from the model: it must return the merged episodes.
with episodes as (

    select
        mmsi,
        idle_start,
        idle_end
    from {{ ref('gold_vessel_idling') }}

),

idle_pings as (

    select
        mmsi,
        event_time
    from {{ ref('silver_ais_positions') }}
    where sog_knots <= {{ var('idle_speed_knots') }}

),

pings_within_episode as (

    select
        e.mmsi,
        e.idle_start,
        e.idle_end,
        p.event_time,
        date_diff(
            'minute',
            lag(p.event_time) over (partition by e.mmsi, e.idle_start order by p.event_time),
            p.event_time
        ) as gap_minutes
    from episodes e
    inner join idle_pings p
        on p.mmsi = e.mmsi
       and p.event_time between e.idle_start and e.idle_end

)

select
    mmsi,
    idle_start,
    idle_end,
    event_time,
    gap_minutes
from pings_within_episode
where gap_minutes > {{ var('idle_max_gap_minutes') }}
