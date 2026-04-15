SELECT ('-- ### PUBLIC SERVICE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.service SELECT * FROM json_populate_record(NULL::public.service, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.service t
  ), '')) AS part;