SELECT ('-- ### PUBLIC APPOINTMENT NOTIFICATION' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_notification SELECT * FROM json_populate_record(NULL::public.appointment_notification, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_notification t
  ), '')) AS part;