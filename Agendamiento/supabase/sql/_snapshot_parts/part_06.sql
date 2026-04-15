SELECT ('-- ### PUBLIC ROLE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.role SELECT * FROM json_populate_record(NULL::public.role, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.role t
  ), '')) AS part;