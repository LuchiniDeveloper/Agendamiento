SELECT ('-- ### AUTH SCHEMA MIGRATIONS (GoTrue internals; opcional al restaurar)' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.schema_migrations SELECT * FROM json_populate_record(NULL::auth.schema_migrations, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.schema_migrations t
  ), '')) AS part;