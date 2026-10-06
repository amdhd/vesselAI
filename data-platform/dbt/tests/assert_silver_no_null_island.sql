-- Singular test: no ping may sit at (0, 0).
--
-- "Null island" is what a GPS receiver reports when it has no fix, and it is
-- the one bad coordinate the generic coordinate tests cannot catch — a row at
-- (0, 0) is inside both the latitude and longitude bounds, so
-- `between_latitude__90__90` passes it. The model's `not (latitude = 0 and
-- longitude = 0)` filter is the only guard on it.
--
-- Note when verifying this test by deleting that filter: it may still pass.
-- In the sample data all 8 bronze (0,0) rows are exact duplicates of a real
-- ping at the same (mmsi, event_time) *with an identical SOG*, so the dedupe
-- tiebreak `order by sog_knots desc nulls last` is a pure tie and quietly
-- drops them — but which copy wins is plan-dependent, not guaranteed: the same
-- guardless query kept 5 of the 8 under a different plan. That is the point of
-- the filter. It is not that dedupe fails to catch null island; it is that
-- dedupe catches it by luck, and a (0,0) row with no clean twin (or a higher
-- SOG than its twin) would flow straight through to tracks and voyage
-- distances. Passes when it returns zero rows.
select
    mmsi,
    event_time,
    latitude,
    longitude
from {{ ref('silver_ais_positions') }}
where latitude = 0
  and longitude = 0
