SELECT ('-- ### AUTH MFA AMR CLAIMS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.mfa_amr_claims SELECT * FROM json_populate_record(NULL::auth.mfa_amr_claims, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.mfa_amr_claims t
  ), '')) AS part;