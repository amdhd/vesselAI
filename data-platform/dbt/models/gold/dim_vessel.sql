-- dim_vessel  —  the DIMENSION: one row per vessel, describing WHO it is.
--
-- In a star schema, dimensions hold the descriptive "context" (names, types,
-- sizes) and facts hold the numeric "measurements" (see fct_vessel_daily). We
-- keep them separate so the same vessel description is stored once and reused by
-- every fact row, and so questions like "distance by vessel type" become a
-- simple join.
--
-- A vessel's reported attributes can vary or be blank across its pings (small
-- craft often omit name/IMO). For each attribute we therefore take the MOST
-- RECENT KNOWN value: arg_max(value, event_time) picks the value at the latest
-- timestamp, and FILTER (where value is not null) makes it ignore blanks — so a
-- later blank never overwrites an earlier real name.
--
-- fleet_id is the one column NOT observed from AIS. It comes from the
-- hand-maintained ownership registry (seeds/vessel_fleet_registry.csv — see its
-- _seeds.yml for why ownership is declared rather than inferred), and it is what
-- the analytics API scopes on: NULL means public broadcast data any fleet may
-- see; a value means only that fleet may.

with silver as (

    select * from {{ ref('silver_ais_positions') }}

),

registry as (

    select mmsi, fleet_id from {{ ref('vessel_fleet_registry') }}

),

collapsed as (

    select
        mmsi,
        arg_max(vessel_name,       event_time) filter (where vessel_name is not null)       as vessel_name,
        arg_max(imo,               event_time) filter (where imo is not null)               as imo,
        arg_max(call_sign,         event_time) filter (where call_sign is not null)         as call_sign,
        arg_max(vessel_type_code,  event_time) filter (where vessel_type_code is not null)  as vessel_type_code,
        arg_max(length_m,          event_time) filter (where length_m is not null)          as length_m,
        arg_max(width_m,           event_time) filter (where width_m is not null)           as width_m,
        arg_max(draft_m,           event_time) filter (where draft_m is not null)           as draft_m,
        arg_max(transceiver_class, event_time) filter (where transceiver_class is not null) as transceiver_class
    from silver
    group by mmsi

)

select
    collapsed.mmsi,
    -- LEFT join: a vessel absent from the registry is public, not dropped. The
    -- registry's unique-mmsi test is what keeps this join from fanning out, and
    -- this model's own unique-mmsi test would catch it if that ever slipped.
    registry.fleet_id,
    vessel_name,
    imo,
    call_sign,
    vessel_type_code,
    -- Decode the numeric AIS type code into a human label (real AIS uses ranges).
    case
        when vessel_type_code between 60 and 69 then 'Passenger'
        when vessel_type_code between 70 and 79 then 'Cargo'
        when vessel_type_code between 80 and 89 then 'Tanker'
        when vessel_type_code = 30              then 'Fishing'
        when vessel_type_code in (31, 32, 52)   then 'Tug / Tow'
        else 'Other / Unknown'
    end as vessel_type_desc,
    transceiver_class,
    length_m,
    width_m,
    draft_m
from collapsed
left join registry on registry.mmsi = collapsed.mmsi
