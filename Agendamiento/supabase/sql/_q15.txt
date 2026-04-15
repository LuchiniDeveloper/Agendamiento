SELECT ('-- ### PUBLIC MEDICAL RECORD' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.medical_record SELECT * FROM json_populate_record(NULL::public.medical_record, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.medical_record t
  ), '')) AS part;