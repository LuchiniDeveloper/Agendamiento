SELECT ('-- ### PUBLIC PAYMENT' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.payment SELECT * FROM json_populate_record(NULL::public.payment, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.payment t
  ), '')) AS part;