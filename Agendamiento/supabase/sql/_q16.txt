SELECT ('-- ### PUBLIC REMINDER' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.reminder SELECT * FROM json_populate_record(NULL::public.reminder, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.reminder t
  ), '')) AS part;