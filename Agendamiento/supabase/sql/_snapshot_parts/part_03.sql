SELECT ('-- ### AUTH SESSIONS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.sessions SELECT * FROM json_populate_record(NULL::auth.sessions, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.sessions t
  ), '')) AS part;