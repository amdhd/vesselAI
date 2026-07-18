-- Singular test (a one-off assertion, not reusable like a generic test).
-- Asserts the dedupe worked: there must be AT MOST one row per
-- (mmsi, event_time) in silver. If dedupe is correct this returns zero rows
-- and the test passes; any returned row is a leftover duplicate.
select
    mmsi,
    event_time,
    count(*) as n_rows
from {{ ref('silver_ais_positions') }}
group by mmsi, event_time
having count(*) > 1
