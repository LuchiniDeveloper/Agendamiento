SELECT ('-- ### PUBLIC STAFF' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.staff SELECT * FROM json_populate_record(NULL::public.staff, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.staff t
  ), '')) AS part;