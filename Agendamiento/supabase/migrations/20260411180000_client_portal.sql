-- Client portal: document on customer, portal account link, booking_source + guest notifications skip,
-- RLS for portal users, portal booking RPC, public guest booking RPC.

-- -----------------------------------------------------------------------------
-- Document normalization (digits only for cédula-style IDs)
-- -----------------------------------------------------------------------------
create or replace function public.normalize_id_document(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(trim(coalesce(p, '')), '\D', '', 'g'), '');
$$;

-- -----------------------------------------------------------------------------
-- customer.id_document
-- -----------------------------------------------------------------------------
alter table public.customer
  add column if not exists id_document text,
  add column if not exists id_document_verified_at timestamptz;

create unique index if not exists uq_customer_business_id_document
  on public.customer (business_id, (public.normalize_id_document(id_document)))
  where public.normalize_id_document(id_document) is not null;

-- -----------------------------------------------------------------------------
-- Portal account (one auth user per customer with portal access)
-- -----------------------------------------------------------------------------
create table if not exists public.customer_portal_account (
  customer_id uuid primary key references public.customer (id) on delete cascade,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  login_email_internal text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists idx_portal_account_auth on public.customer_portal_account (auth_user_id);

alter table public.customer_portal_account enable row level security;

create policy portal_account_self_read
  on public.customer_portal_account
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- appointment.booking_source (staff | public | public_guest | portal)
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.appointment_booking_source as enum (
    'staff',
    'public',
    'public_guest',
    'portal'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.appointment
  add column if not exists booking_source public.appointment_booking_source not null default 'staff';

-- Backfill legacy rows
update public.appointment a
set booking_source = 'public'
where a.notes = 'Reserva web'
  and a.booking_source = 'staff';

-- -----------------------------------------------------------------------------
-- Allow explicit business_id on customer/appointment when no staff session (portal/service)
-- -----------------------------------------------------------------------------
create or replace function public.set_business_id_from_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
begin
  bid := public.current_business_id();
  if bid is not null then
    if tg_table_name = 'customer' or tg_table_name = 'service' or tg_table_name = 'appointment' then
      new.business_id := bid;
    end if;
    return new;
  end if;
  if new.business_id is null then
    raise exception 'No active staff profile';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Email notifications: skip entirely for public_guest
-- -----------------------------------------------------------------------------
create or replace function public.tg_appointment_notify_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  agendada smallint;
  smtp_on boolean;
begin
  if new.booking_source = 'public_guest'::public.appointment_booking_source then
    return new;
  end if;

  agendada := public._appointment_status_id('Agendada');
  if agendada is null then
    return new;
  end if;

  select nullif(trim(c.email), '') into em
  from public.customer c
  where c.id = new.customer_id;

  select coalesce(s.enabled, false) into smtp_on
  from public.business_smtp_settings s
  where s.business_id = new.business_id;

  if em is null then
    insert into public.appointment_notification (
      business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
    ) values (
      new.business_id, new.id, 'CREATED', 'skipped', null,
      'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
    );
  elsif not smtp_on then
    insert into public.appointment_notification (
      business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
    ) values (
      new.business_id, new.id, 'CREATED', 'skipped', em,
      'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
    );
  else
    insert into public.appointment_notification (
      business_id, appointment_id, kind, status, scheduled_for, recipient_email, payload_snapshot
    ) values (
      new.business_id, new.id, 'CREATED', 'pending', null, em,
      jsonb_build_object('customer_hint', left(em, 3) || '***')
    );
  end if;

  if new.status_id = agendada then
    if em is null or not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, scheduled_for, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'CONFIRM_REMINDER', 'skipped',
        new.start_date_time - interval '1 hour', em,
        case when em is null then 'Sin correo del cliente' else 'SMTP desactivado o sin configurar' end,
        jsonb_build_object('reason', case when em is null then 'no_email' else 'smtp_disabled' end)
      );
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, scheduled_for, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'CONFIRM_REMINDER', 'scheduled',
        new.start_date_time - interval '1 hour', em,
        jsonb_build_object('scheduled_note', '1h antes de la cita')
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.tg_appointment_notify_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  agendada smallint;
  confirmada smallint;
  completada smallint;
  cancelada smallint;
  noshow smallint;
  em text;
  smtp_on boolean;
  diag text;
begin
  if new.booking_source = 'public_guest'::public.appointment_booking_source then
    return new;
  end if;

  if new.status_id is not distinct from old.status_id then
    return new;
  end if;

  agendada := public._appointment_status_id('Agendada');
  confirmada := public._appointment_status_id('Confirmada');
  completada := public._appointment_status_id('Completada');
  cancelada := public._appointment_status_id('Cancelada');
  noshow := public._appointment_status_id('NoShow');

  select nullif(trim(c.email), '') into em
  from public.customer c
  where c.id = new.customer_id;

  select coalesce(s.enabled, false) into smtp_on
  from public.business_smtp_settings s
  where s.business_id = new.business_id;

  if old.status_id = agendada and new.status_id = confirmada then
    update public.appointment_notification
    set status = 'skipped',
        last_error = 'Cita confirmada antes del recordatorio',
        updated_at = now()
    where appointment_id = new.id
      and kind = 'CONFIRM_REMINDER'
      and status in ('pending', 'scheduled', 'sending');
  end if;

  if new.status_id = completada and old.status_id is distinct from completada then
    select string_agg(coalesce(m.diagnosis, ''), ' ')
      into diag
    from public.medical_record m
    where m.appointment_id = new.id;

    if em is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'COMPLETED_SUMMARY', 'skipped', null,
        'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
      )
      on conflict (appointment_id, kind) do nothing;
    elsif not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'COMPLETED_SUMMARY', 'skipped', em,
        'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
      )
      on conflict (appointment_id, kind) do nothing;
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'COMPLETED_SUMMARY', 'pending', em,
        jsonb_build_object(
          'diagnosis_excerpt', left(coalesce(diag, ''), 400)
        )
      )
      on conflict (appointment_id, kind) do nothing;
    end if;
  end if;

  if new.status_id = cancelada and old.status_id is distinct from cancelada then
    update public.appointment_notification
    set status = 'skipped', last_error = 'Cita cancelada', updated_at = now()
    where appointment_id = new.id
      and kind = 'CONFIRM_REMINDER'
      and status in ('pending', 'scheduled', 'sending');

    if em is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'CANCELLED_ACK', 'skipped', null,
        'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
      )
      on conflict (appointment_id, kind) do nothing;
    elsif not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'CANCELLED_ACK', 'skipped', em,
        'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
      )
      on conflict (appointment_id, kind) do nothing;
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'CANCELLED_ACK', 'pending', em, '{}'::jsonb
      )
      on conflict (appointment_id, kind) do nothing;
    end if;
  end if;

  if new.status_id = noshow and old.status_id is distinct from noshow then
    if em is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'NOSHOW_RESCHEDULE', 'skipped', null,
        'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
      )
      on conflict (appointment_id, kind) do nothing;
    elsif not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'NOSHOW_RESCHEDULE', 'skipped', em,
        'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
      )
      on conflict (appointment_id, kind) do nothing;
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'NOSHOW_RESCHEDULE', 'pending', em,
        jsonb_build_object('tone', 'reschedule')
      )
      on conflict (appointment_id, kind) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stable internal login email (must match Edge Function portal-auth)
-- -----------------------------------------------------------------------------
create or replace function public.portal_internal_login_email(p_business_id uuid, p_id_document text)
returns text
language sql
immutable
set search_path = public
as $$
  select
    'p-' || md5(public.normalize_id_document(p_id_document) || '|' || p_business_id::text)
    || '-' || replace(p_business_id::text, '-', '')
    || '@client.agendamiento.invalid';
$$;

grant execute on function public.portal_internal_login_email(uuid, text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Portal session helpers (SECURITY DEFINER: only exposes own link)
-- -----------------------------------------------------------------------------
create or replace function public.current_portal_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cpa.customer_id
  from public.customer_portal_account cpa
  where cpa.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_portal_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.business_id
  from public.customer_portal_account cpa
  join public.customer c on c.id = cpa.customer_id
  where cpa.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_portal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customer_portal_account cpa where cpa.auth_user_id = auth.uid()
  );
$$;

grant execute on function public.current_portal_customer_id() to authenticated;
grant execute on function public.current_portal_business_id() to authenticated;
grant execute on function public.is_portal_user() to authenticated;

-- -----------------------------------------------------------------------------
-- RLS: portal policies (staff policies unchanged)
-- -----------------------------------------------------------------------------
create policy customer_portal_select
  on public.customer
  for select
  to authenticated
  using (id = public.current_portal_customer_id());

create policy customer_portal_update
  on public.customer
  for update
  to authenticated
  using (id = public.current_portal_customer_id())
  with check (id = public.current_portal_customer_id());

-- Portal users cannot change negocio, notas internas ni documento (validación en trigger)
create or replace function public.trg_customer_portal_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.customer_portal_account cpa
    where cpa.customer_id = new.id and cpa.auth_user_id = auth.uid()
  ) then
    if new.business_id is distinct from old.business_id
      or new.notes is distinct from old.notes
      or public.normalize_id_document(new.id_document) is distinct from public.normalize_id_document(old.id_document)
    then
      raise exception 'PORTAL_UPDATE_FORBIDDEN'
        using message = 'No podés modificar negocio, notas ni documento desde el portal';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_portal_guard on public.customer;
create trigger trg_customer_portal_guard
  before update on public.customer
  for each row execute function public.trg_customer_portal_update_guard();

create policy pet_portal_select
  on public.pet
  for select
  to authenticated
  using (customer_id = public.current_portal_customer_id());

create policy appointment_portal_select
  on public.appointment
  for select
  to authenticated
  using (customer_id = public.current_portal_customer_id());

create policy medical_portal_select
  on public.medical_record
  for select
  to authenticated
  using (
    exists (
      select 1 from public.pet p
      where p.id = medical_record.pet_id
        and p.customer_id = public.current_portal_customer_id()
    )
  );

-- -----------------------------------------------------------------------------
-- Update public booking to set booking_source = public
-- -----------------------------------------------------------------------------
create or replace function public.create_public_booking_appointment(
  p_business_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_pet_name text,
  p_pet_species text,
  p_service_id uuid,
  p_user_id uuid,
  p_on_date date,
  p_start_hhmm text,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slots text[];
  agendada smallint;
  dur int;
  y int; mo int; d int;
  start_ts timestamptz;
  end_ts timestamptz;
  cust_id uuid;
  pet_id uuid;
  appt_id uuid;
  phone_clean text;
  email_clean text;
begin
  if not exists (
    select 1 from public.business b
    where b.id = p_business_id and b.active and b.public_booking_enabled
  ) then
    return json_build_object('ok', false, 'error', 'BOOKING_DISABLED');
  end if;

  agendada := public._appointment_status_id('Agendada');
  if agendada is null then
    return json_build_object('ok', false, 'error', 'CONFIG');
  end if;

  phone_clean := nullif(trim(coalesce(p_customer_phone, '')), '');
  email_clean := nullif(trim(lower(coalesce(p_customer_email, ''))), '');

  if length(trim(coalesce(p_customer_name, ''))) < 2 then
    return json_build_object('ok', false, 'error', 'NAME');
  end if;
  if length(trim(coalesce(p_pet_name, ''))) < 1 then
    return json_build_object('ok', false, 'error', 'PET');
  end if;
  if phone_clean is null and email_clean is null then
    return json_build_object('ok', false, 'error', 'CONTACT');
  end if;

  select duration_minutes into dur
  from public.service
  where id = p_service_id and business_id = p_business_id and active
  limit 1;
  if dur is null then
    return json_build_object('ok', false, 'error', 'SERVICE');
  end if;

  v_slots := public.get_available_slots_public(
    p_business_id, p_user_id, p_service_id, p_on_date, p_tz, null, null
  );
  if not (p_start_hhmm = any (v_slots)) then
    return json_build_object('ok', false, 'error', 'SLOT_TAKEN');
  end if;

  y := extract(year from p_on_date)::int;
  mo := extract(month from p_on_date)::int;
  d := extract(day from p_on_date)::int;
  start_ts := make_timestamptz(
    y, mo, d,
    split_part(p_start_hhmm, ':', 1)::int,
    split_part(p_start_hhmm, ':', 2)::int,
    0::double precision,
    p_tz
  );
  end_ts := start_ts + make_interval(mins => dur);

  if start_ts <= now() then
    return json_build_object('ok', false, 'error', 'PAST');
  end if;

  select c.id into cust_id
  from public.customer c
  where c.business_id = p_business_id
    and (
      (phone_clean is not null and c.phone is not null and trim(c.phone) = phone_clean)
      or (email_clean is not null and c.email is not null and lower(trim(c.email)) = email_clean)
    )
  limit 1;

  if cust_id is null then
    insert into public.customer (business_id, name, phone, email)
    values (
      p_business_id,
      trim(p_customer_name),
      phone_clean,
      email_clean
    )
    returning id into cust_id;
  else
    update public.customer
    set name = coalesce(nullif(trim(p_customer_name), ''), name),
        phone = coalesce(phone_clean, phone),
        email = coalesce(email_clean, email)
    where id = cust_id;
  end if;

  select p.id into pet_id
  from public.pet p
  where p.customer_id = cust_id
    and lower(trim(p.name)) = lower(trim(p_pet_name))
  limit 1;

  if pet_id is null then
    insert into public.pet (customer_id, name, species)
    values (cust_id, trim(p_pet_name), nullif(trim(coalesce(p_pet_species, '')), ''))
    returning id into pet_id;
  end if;

  insert into public.appointment (
    business_id,
    customer_id,
    pet_id,
    service_id,
    user_id,
    start_date_time,
    end_date_time,
    status_id,
    notes,
    booking_source
  )
  values (
    p_business_id,
    cust_id,
    pet_id,
    p_service_id,
    p_user_id,
    start_ts,
    end_ts,
    agendada,
    'Reserva web',
    'public'::public.appointment_booking_source
  )
  returning id into appt_id;

  return json_build_object('ok', true, 'appointment_id', appt_id);
end;
$$;

grant execute on function public.create_public_booking_appointment(
  uuid, text, text, text, text, text, uuid, uuid, date, text, text
) to anon, authenticated;

-- Guest: same rules but CONTACT not required; no email queue (public_guest)
create or replace function public.create_public_booking_appointment_guest(
  p_business_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_pet_name text,
  p_pet_species text,
  p_service_id uuid,
  p_user_id uuid,
  p_on_date date,
  p_start_hhmm text,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slots text[];
  agendada smallint;
  dur int;
  y int; mo int; d int;
  start_ts timestamptz;
  end_ts timestamptz;
  cust_id uuid;
  pet_id uuid;
  appt_id uuid;
  phone_clean text;
  email_clean text;
begin
  if not exists (
    select 1 from public.business b
    where b.id = p_business_id and b.active and b.public_booking_enabled
  ) then
    return json_build_object('ok', false, 'error', 'BOOKING_DISABLED');
  end if;

  agendada := public._appointment_status_id('Agendada');
  if agendada is null then
    return json_build_object('ok', false, 'error', 'CONFIG');
  end if;

  phone_clean := nullif(trim(coalesce(p_customer_phone, '')), '');
  email_clean := nullif(trim(lower(coalesce(p_customer_email, ''))), '');

  if length(trim(coalesce(p_customer_name, ''))) < 2 then
    return json_build_object('ok', false, 'error', 'NAME');
  end if;
  if length(trim(coalesce(p_pet_name, ''))) < 1 then
    return json_build_object('ok', false, 'error', 'PET');
  end if;

  select duration_minutes into dur
  from public.service
  where id = p_service_id and business_id = p_business_id and active
  limit 1;
  if dur is null then
    return json_build_object('ok', false, 'error', 'SERVICE');
  end if;

  v_slots := public.get_available_slots_public(
    p_business_id, p_user_id, p_service_id, p_on_date, p_tz, null, null
  );
  if not (p_start_hhmm = any (v_slots)) then
    return json_build_object('ok', false, 'error', 'SLOT_TAKEN');
  end if;

  y := extract(year from p_on_date)::int;
  mo := extract(month from p_on_date)::int;
  d := extract(day from p_on_date)::int;
  start_ts := make_timestamptz(
    y, mo, d,
    split_part(p_start_hhmm, ':', 1)::int,
    split_part(p_start_hhmm, ':', 2)::int,
    0::double precision,
    p_tz
  );
  end_ts := start_ts + make_interval(mins => dur);

  if start_ts <= now() then
    return json_build_object('ok', false, 'error', 'PAST');
  end if;

  select c.id into cust_id
  from public.customer c
  where c.business_id = p_business_id
    and (
      (phone_clean is not null and c.phone is not null and trim(c.phone) = phone_clean)
      or (email_clean is not null and c.email is not null and lower(trim(c.email)) = email_clean)
    )
  limit 1;

  if cust_id is null then
    insert into public.customer (business_id, name, phone, email)
    values (
      p_business_id,
      trim(p_customer_name),
      phone_clean,
      email_clean
    )
    returning id into cust_id;
  else
    update public.customer
    set name = coalesce(nullif(trim(p_customer_name), ''), name),
        phone = coalesce(phone_clean, phone),
        email = coalesce(email_clean, email)
    where id = cust_id;
  end if;

  select p.id into pet_id
  from public.pet p
  where p.customer_id = cust_id
    and lower(trim(p.name)) = lower(trim(p_pet_name))
  limit 1;

  if pet_id is null then
    insert into public.pet (customer_id, name, species)
    values (cust_id, trim(p_pet_name), nullif(trim(coalesce(p_pet_species, '')), ''))
    returning id into pet_id;
  end if;

  insert into public.appointment (
    business_id,
    customer_id,
    pet_id,
    service_id,
    user_id,
    start_date_time,
    end_date_time,
    status_id,
    notes,
    booking_source
  )
  values (
    p_business_id,
    cust_id,
    pet_id,
    p_service_id,
    p_user_id,
    start_ts,
    end_ts,
    agendada,
    'Reserva invitado (sin alertas)',
    'public_guest'::public.appointment_booking_source
  )
  returning id into appt_id;

  return json_build_object('ok', true, 'appointment_id', appt_id);
end;
$$;

grant execute on function public.create_public_booking_appointment_guest(
  uuid, text, text, text, text, text, uuid, uuid, date, text, text
) to anon, authenticated;

-- Portal-authenticated booking (customer_id forced from session)
create or replace function public.create_portal_booking_appointment(
  p_business_id uuid,
  p_pet_id uuid,
  p_service_id uuid,
  p_user_id uuid,
  p_on_date date,
  p_start_hhmm text,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust uuid;
  v_slots text[];
  agendada smallint;
  dur int;
  y int; mo int; d int;
  start_ts timestamptz;
  end_ts timestamptz;
  appt_id uuid;
begin
  v_cust := public.current_portal_customer_id();
  if v_cust is null then
    return json_build_object('ok', false, 'error', 'NOT_PORTAL');
  end if;

  if p_business_id is distinct from public.current_portal_business_id() then
    return json_build_object('ok', false, 'error', 'BUSINESS_MISMATCH');
  end if;

  if not exists (
    select 1 from public.business b
    where b.id = p_business_id and b.active and b.public_booking_enabled
  ) then
    return json_build_object('ok', false, 'error', 'BOOKING_DISABLED');
  end if;

  if not exists (
    select 1 from public.pet p
    where p.id = p_pet_id and p.customer_id = v_cust
  ) then
    return json_build_object('ok', false, 'error', 'PET');
  end if;

  agendada := public._appointment_status_id('Agendada');
  if agendada is null then
    return json_build_object('ok', false, 'error', 'CONFIG');
  end if;

  select duration_minutes into dur
  from public.service
  where id = p_service_id and business_id = p_business_id and active
  limit 1;
  if dur is null then
    return json_build_object('ok', false, 'error', 'SERVICE');
  end if;

  v_slots := public.get_available_slots_public(
    p_business_id, p_user_id, p_service_id, p_on_date, p_tz, null, null
  );
  if not (p_start_hhmm = any (v_slots)) then
    return json_build_object('ok', false, 'error', 'SLOT_TAKEN');
  end if;

  y := extract(year from p_on_date)::int;
  mo := extract(month from p_on_date)::int;
  d := extract(day from p_on_date)::int;
  start_ts := make_timestamptz(
    y, mo, d,
    split_part(p_start_hhmm, ':', 1)::int,
    split_part(p_start_hhmm, ':', 2)::int,
    0::double precision,
    p_tz
  );
  end_ts := start_ts + make_interval(mins => dur);

  if start_ts <= now() then
    return json_build_object('ok', false, 'error', 'PAST');
  end if;

  insert into public.appointment (
    business_id,
    customer_id,
    pet_id,
    service_id,
    user_id,
    start_date_time,
    end_date_time,
    status_id,
    notes,
    booking_source
  )
  values (
    p_business_id,
    v_cust,
    p_pet_id,
    p_service_id,
    p_user_id,
    start_ts,
    end_ts,
    agendada,
    'Portal cliente',
    'portal'::public.appointment_booking_source
  )
  returning id into appt_id;

  return json_build_object('ok', true, 'appointment_id', appt_id);
end;
$$;

grant execute on function public.create_portal_booking_appointment(
  uuid, uuid, uuid, uuid, date, text, text
) to authenticated;

-- Solo service_role (Edge Functions): evita enumeración desde anon
create or replace function public.portal_lookup_customer(p_business_id uuid, p_id_document text)
returns table (
  customer_id uuid,
  has_portal boolean,
  phone text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    exists (select 1 from public.customer_portal_account p where p.customer_id = c.id),
    c.phone,
    c.email
  from public.customer c
  where c.business_id = p_business_id
    and public.normalize_id_document(c.id_document) = public.normalize_id_document(p_id_document)
  limit 1;
$$;

grant execute on function public.portal_lookup_customer(uuid, text) to service_role;
