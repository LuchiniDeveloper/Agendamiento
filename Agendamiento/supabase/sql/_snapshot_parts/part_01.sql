SELECT ('-- ### AUTH USERS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format(
        'INSERT INTO auth.users SELECT * FROM json_populate_record(NULL::auth.users, %L::json);',
        (row_to_json(t)::jsonb - 'confirmed_at')::text::json
      ),
      E'\n'
    )
    FROM auth.users t
  ), '')) AS part;