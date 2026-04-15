SELECT ('-- ### PUBLIC APPOINTMENT PUBLIC TOKEN' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_public_token SELECT * FROM json_populate_record(NULL::public.appointment_public_token, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_public_token t
  ), '')) AS part;