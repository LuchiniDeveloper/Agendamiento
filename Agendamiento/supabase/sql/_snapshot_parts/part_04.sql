SELECT ('-- ### AUTH REFRESH TOKENS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.refresh_tokens SELECT * FROM json_populate_record(NULL::auth.refresh_tokens, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.refresh_tokens t
  ), '')) AS part;