SELECT ('-- ### PUBLIC BUSINESS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.business SELECT * FROM json_populate_record(NULL::public.business, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.business t
  ), '')) AS part;