SELECT ('-- ### AUTH IDENTITIES' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format(
        'INSERT INTO auth.identities SELECT * FROM json_populate_record(NULL::auth.identities, %L::json);',
        (row_to_json(t)::jsonb - 'email')::text::json
      ),
      E'\n'
    )
    FROM auth.identities t
  ), '')) AS part;