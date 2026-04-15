SELECT ('-- ### PUBLIC APPOINTMENT' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment SELECT * FROM json_populate_record(NULL::public.appointment, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment t
  ), '')) AS part;