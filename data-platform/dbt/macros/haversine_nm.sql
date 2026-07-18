-- haversine_nm: great-circle distance between two lat/lon points, in NAUTICAL
-- MILES. We use nautical miles because AIS speed (SOG) is in knots = nm/hour,
-- so distances and speeds share units. 3440.065 is Earth's mean radius in nm.
--
-- It's a macro (not repeated inline) so fct_vessel_daily stays readable:
--   {{ haversine_nm('prev_lat', 'prev_lon', 'latitude', 'longitude') }} as segment_nm
--
-- Note: this is a straight-line (great-circle) hop between consecutive pings.
-- Summing these APPROXIMATES distance travelled — it slightly over-counts on
-- noisy GPS and under-counts across long gaps between pings. Good enough for a
-- daily activity estimate; a production version would smooth/clip outliers.
{% macro haversine_nm(lat1, lon1, lat2, lon2) %}
    (2 * 3440.065 * asin(sqrt(
        pow(sin(radians(({{ lat2 }} - {{ lat1 }})) / 2), 2)
        + cos(radians({{ lat1 }})) * cos(radians({{ lat2 }}))
          * pow(sin(radians(({{ lon2 }} - {{ lon1 }})) / 2), 2)
    )))
{% endmacro %}
