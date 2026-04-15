SELECT
  '-- ### AUTH USERS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format(
        'INSERT INTO auth.users SELECT * FROM json_populate_record(NULL::auth.users, %L::json);',
        (row_to_json(t)::jsonb - 'confirmed_at')::text::json
      ),
      E'\n'
    )
    FROM auth.users t
  ), '') || E'\n\n' ||

  '-- ### AUTH IDENTITIES' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format(
        'INSERT INTO auth.identities SELECT * FROM json_populate_record(NULL::auth.identities, %L::json);',
        (row_to_json(t)::jsonb - 'email')::text::json
      ),
      E'\n'
    )
    FROM auth.identities t
  ), '') || E'\n\n' ||

  '-- ### AUTH SESSIONS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.sessions SELECT * FROM json_populate_record(NULL::auth.sessions, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.sessions t
  ), '') || E'\n\n' ||

  '-- ### AUTH REFRESH TOKENS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.refresh_tokens SELECT * FROM json_populate_record(NULL::auth.refresh_tokens, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.refresh_tokens t
  ), '') || E'\n\n' ||

  '-- ### AUTH MFA AMR CLAIMS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.mfa_amr_claims SELECT * FROM json_populate_record(NULL::auth.mfa_amr_claims, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.mfa_amr_claims t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC ROLE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.role SELECT * FROM json_populate_record(NULL::public.role, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.role t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC APPOINTMENT_STATUS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_status SELECT * FROM json_populate_record(NULL::public.appointment_status, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_status t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC BUSINESS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.business SELECT * FROM json_populate_record(NULL::public.business, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.business t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC STAFF' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.staff SELECT * FROM json_populate_record(NULL::public.staff, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.staff t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC CUSTOMER' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.customer SELECT * FROM json_populate_record(NULL::public.customer, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.customer t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC PET' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.pet SELECT * FROM json_populate_record(NULL::public.pet, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.pet t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC SERVICE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.service SELECT * FROM json_populate_record(NULL::public.service, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.service t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC SCHEDULE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.schedule SELECT * FROM json_populate_record(NULL::public.schedule, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.schedule t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC APPOINTMENT' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment SELECT * FROM json_populate_record(NULL::public.appointment, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC PAYMENT' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.payment SELECT * FROM json_populate_record(NULL::public.payment, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.payment t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC MEDICAL RECORD' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.medical_record SELECT * FROM json_populate_record(NULL::public.medical_record, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.medical_record t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC REMINDER' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.reminder SELECT * FROM json_populate_record(NULL::public.reminder, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.reminder t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC BUSINESS SMTP SETTINGS (revisar smtp_password)' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.business_smtp_settings SELECT * FROM json_populate_record(NULL::public.business_smtp_settings, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.business_smtp_settings t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC APPOINTMENT NOTIFICATION' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_notification SELECT * FROM json_populate_record(NULL::public.appointment_notification, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_notification t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC APPOINTMENT PUBLIC TOKEN' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_public_token SELECT * FROM json_populate_record(NULL::public.appointment_public_token, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_public_token t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC CUSTOMER PORTAL ACCOUNT' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.customer_portal_account SELECT * FROM json_populate_record(NULL::public.customer_portal_account, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.customer_portal_account t
  ), '') || E'\n\n' ||

  '-- ### PUBLIC APPOINTMENT EXTRA CHARGE' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO public.appointment_extra_charge SELECT * FROM json_populate_record(NULL::public.appointment_extra_charge, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM public.appointment_extra_charge t
  ), '') || E'\n\n' ||

  '-- ### STORAGE MIGRATIONS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO storage.migrations SELECT * FROM json_populate_record(NULL::storage.migrations, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM storage.migrations t
  ), '') || E'\n\n' ||

  '-- ### REALTIME SCHEMA MIGRATIONS' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO realtime.schema_migrations SELECT * FROM json_populate_record(NULL::realtime.schema_migrations, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM realtime.schema_migrations t
  ), '') || E'\n\n' ||

  '-- ### AUTH SCHEMA MIGRATIONS (GoTrue internals; opcional al restaurar)' || E'\n' ||
  COALESCE((
    SELECT string_agg(
      format('INSERT INTO auth.schema_migrations SELECT * FROM json_populate_record(NULL::auth.schema_migrations, %L::json);', row_to_json(t)::text),
      E'\n'
    )
    FROM auth.schema_migrations t
  ), '') AS full_dump;