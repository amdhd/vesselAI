-- Singular test: every MMSI in silver must be 9 digits.
--
-- MMSI is the vessel identifier and the backbone of everything downstream —
-- tracks, the dim_vessel join, per-vessel aggregates. Bronze contains blanks,
-- 7/8/10-digit values and a literal '0' (explore.sql Q3 counts 2,867 of them);
-- before this was enforced in the model they became 11 phantom vessels in
-- dim_vessel, including a '0' pseudo-vessel merging every "identifier
-- unavailable" ping. Passes when it returns zero rows.
select
    mmsi,
    count(*) as n_rows
from {{ ref('silver_ais_positions') }}
where not regexp_matches(mmsi, '^[0-9]{9}$')
group by mmsi
