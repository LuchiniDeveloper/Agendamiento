SELECT ('-- ### PUBLIC BUSINESS SMTP SETTINGS (revisar smtp_password)' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.business_smtp_settings SELECT * FROM json_populate_record(NULL::public.business_smtp_settings, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.business_smtp_settings t
  ), '')) AS part;