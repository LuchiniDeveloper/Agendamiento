SELECT ('-- ### PUBLIC CUSTOMER' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.customer SELECT * FROM json_populate_record(NULL::public.customer, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.customer t
  ), '')) AS part;