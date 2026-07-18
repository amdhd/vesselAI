-- Custom generic test: `between`.
-- Fails (returns rows) for any value outside the inclusive range [min, max].
-- We write it ourselves instead of pulling in the dbt_utils package, so the
-- project needs no `dbt deps` download and stays fully offline.
--
-- Use in a schema.yml like:
--   tests:
--     - between: {min_value: -90, max_value: 90}
{% test between(model, column_name, min_value, max_value) %}

select {{ column_name }}
from {{ model }}
where {{ column_name }} < {{ min_value }}
   or {{ column_name }} > {{ max_value }}

{% endtest %}
