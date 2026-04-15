SELECT ('-- ### PUBLIC CUSTOMER PORTAL ACCOUNT' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.customer_portal_account SELECT * FROM json_populate_record(NULL::public.customer_portal_account, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.customer_portal_account t
  ), '')) AS part;