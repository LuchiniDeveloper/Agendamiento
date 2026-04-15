SELECT ('-- ### STORAGE MIGRATIONS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO storage.migrations SELECT * FROM json_populate_record(NULL::storage.migrations, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM storage.migrations t
  ), '')) AS part;