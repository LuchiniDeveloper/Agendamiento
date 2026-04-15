SELECT ('-- ### PUBLIC APPOINTMENT_STATUS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_status SELECT * FROM json_populate_record(NULL::public.appointment_status, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_status t
  ), '')) AS part;