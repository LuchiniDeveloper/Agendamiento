SELECT ('-- ### PUBLIC PET' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.pet SELECT * FROM json_populate_record(NULL::public.pet, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.pet t
  ), '')) AS part;