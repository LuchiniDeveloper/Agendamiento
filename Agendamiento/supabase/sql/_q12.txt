SELECT ('-- ### PUBLIC SCHEDULE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.schedule SELECT * FROM json_populate_record(NULL::public.schedule, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.schedule t
  ), '')) AS part;