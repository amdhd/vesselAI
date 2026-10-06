-- Singular test: every non-null SOG in silver must be a real speed.
--
-- Two conditions on purpose:
--   1. The AIS "speed not available" sentinel is the literal 102.3. It is
--      checked against that literal rather than the band alone, so this test
--      still catches the sentinel if max_plausible_knots is ever raised.
--   2. No value may sit outside the plausible band the model applies.
--
-- Neither is a stylistic bound. Left in, the sentinel reaches fct_vessel_daily
-- and reports 60+ knot *averages* for a vessel-day via /api/analytics. Passes
-- when it returns zero rows.
select
    mmsi,
    event_time,
    sog_knots
from {{ ref('silver_ais_positions') }}
where sog_knots is not null
  and (
      sog_knots = 102.3                             -- AIS sentinel, never a measurement
      or sog_knots < 0
      or sog_knots > {{ var('max_plausible_knots') }}
  )
