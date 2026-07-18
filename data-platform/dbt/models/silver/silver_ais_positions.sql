-- silver_ais_positions
-- The first "trustworthy" layer: one clean, correctly-typed row per real AIS
-- ping. We read the raw text from bronze and, in a deliberate order:
--   1) TYPE it   - parse text into real numbers / timestamps (bad text -> NULL)
--   2) VALIDATE  - keep only rows with a usable MMSI, timestamp and coordinates
--   3) DEDUPE    - collapse repeat transmissions to one row per vessel + instant
--
-- Why this order? We VALIDATE before we DEDUPE. When a good ping and a corrupt
-- copy share the same (mmsi, event_time), the corrupt one is filtered out first,
-- so dedupe is left choosing among genuinely-good rows. If we deduped first we
-- might keep the corrupt copy and throw the good position away.

with source as (

    select * from {{ source('bronze', 'ais_positions_raw') }}

),

typed as (

    -- Parse raw text into proper types. TRY_CAST returns NULL (instead of
    -- erroring) when text isn't a valid number/timestamp — that's how "91.0",
    -- "" or garbage becomes a NULL we can filter out in the next step.
    select
        nullif(trim(MMSI), '')                as mmsi,             -- keep as TEXT: an identifier, not a quantity
        try_cast(BaseDateTime as timestamp)   as event_time,
        try_cast(LAT as double)               as latitude,
        try_cast(LON as double)               as longitude,
        try_cast(SOG as double)               as sog_knots,        -- speed over ground
        try_cast(COG as double)               as cog_degrees,      -- course over ground
        try_cast(Heading as double)           as heading_degrees,
        nullif(trim(VesselName), '')          as vessel_name,
        nullif(trim(IMO), '')                 as imo,
        nullif(trim(CallSign), '')            as call_sign,
        try_cast(VesselType as integer)       as vessel_type_code,
        try_cast(Status as integer)           as nav_status_code,
        try_cast(Length as double)            as length_m,
        try_cast(Width as double)             as width_m,
        try_cast(Draft as double)             as draft_m,
        try_cast(Cargo as integer)            as cargo_code,
        nullif(trim(TransceiverClass), '')    as transceiver_class,
        _source_file,
        _ingested_at
    from source

),

validated as (

    -- Keep only rows we can trust. Each condition maps directly to a problem we
    -- found in the bronze exploration (see notebooks_or_scripts/explore.sql).
    select *
    from typed
    where mmsi is not null                       -- no vessel id -> unusable  (drops missing MMSI)
      and event_time is not null                 -- unparseable timestamp
      and latitude  between -90 and 90           -- impossible latitude
      and longitude between -180 and 180         -- impossible longitude
      and not (latitude = 0 and longitude = 0)   -- GPS "null island" sentinel (0/0)

),

deduped as (

    -- One row per vessel per instant. A vessel can only be in one place at one
    -- time, so (mmsi, event_time) is the natural key for AIS. After validation
    -- the remaining duplicates are identical repeat transmissions, so the
    -- tiebreak below is deterministic-but-arbitrary (any copy is fine to keep).
    select *
    from validated
    qualify row_number() over (
        partition by mmsi, event_time
        order by sog_knots desc nulls last
    ) = 1

)

select * from deduped
