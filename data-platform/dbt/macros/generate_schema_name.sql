-- Make dbt build models into the schema we name in `+schema` (e.g. "silver"),
-- instead of dbt's default behaviour of prefixing the target schema, which
-- would give us "main_silver" / "main_gold". This keeps the warehouse schemas
-- clean and aligned with the medallion layers: bronze / silver / gold.
--
-- This is the standard, documented dbt override for custom schema names.
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
