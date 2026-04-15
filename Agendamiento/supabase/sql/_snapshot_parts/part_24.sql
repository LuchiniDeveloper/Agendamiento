SELECT ('-- ### REALTIME SCHEMA MIGRATIONS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO realtime.schema_migrations SELECT * FROM json_populate_record(NULL::realtime.schema_migrations, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM realtime.schema_migrations t
  ), '')) AS part;