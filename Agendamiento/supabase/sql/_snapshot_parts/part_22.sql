SELECT ('-- ### PUBLIC APPOINTMENT EXTRA CHARGE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_extra_charge SELECT * FROM json_populate_record(NULL::public.appointment_extra_charge, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_extra_charge t
  ), '')) AS part;