-- Email notifications: cola, SMTP por negocio, tokens públicos, RPCs y triggers.

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.notification_kind as enum (
    'CREATED',
    'CONFIRM_REMINDER',
    'COMPLETED_SUMMARY',
    'CANCELLED_ACK',
    'NOSHOW_RESCHEDULE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_channel as enum ('email');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_status as enum (
    'pending',
    'scheduled',
    'sending',
    'sent',
    'failed',
    'skipped'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.appointment_token_purpose as enum ('confirm', 'reschedule');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Business: reserva pública opcional
-- -----------------------------------------------------------------------------
alter table public.business
  add column if not exists public_booking_enabled boolean not null default true;

-- -----------------------------------------------------------------------------
-- SMTP
-- -----------------------------------------------------------------------------
create table if not exists public.business_smtp_settings (
  business_id uuid primary key references public.business (id) on delete cascade,
  host text not null default 'smtp.gmail.com',
  port int not null default 587,
  use_tls boolean not null default true,
  username text not null default '',
  smtp_password text not null default '',
  from_email text not null default '',
  from_name text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Cola / historial de notificaciones por correo
-- -----------------------------------------------------------------------------
create table if not exists public.appointment_notification (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  appointment_id uuid not null references public.appointment (id) on delete cascade,
  kind public.notification_kind not null,
  channel public.notification_channel not null default 'email',
  status public.notification_status not null default 'pending',
  scheduled_for timestamptz,
  recipient_email text,
  attempt_count int not null default 0,
  last_error text,
  sent_at timestamptz,
  provider_message_id text,
  payload_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_appt_notif_business_created
  on public.appointment_notification (business_id, created_at desc);
create index if not exists idx_appt_notif_appt
  on public.appointment_notification (appointment_id);
create index if not exists idx_appt_notif_status_scheduled
  on public.appointment_notification (status, scheduled_for)
  where status in ('pending', 'scheduled');

create unique index if not exists uniq_appt_notif_appt_kind
  on public.appointment_notification (appointment_id, kind);

-- -----------------------------------------------------------------------------
-- Tokens opacos para enlaces públicos
-- -----------------------------------------------------------------------------
create table if not exists public.appointment_public_token (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointment (id) on delete cascade,
  purpose public.appointment_token_purpose not null,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (appointment_id, purpose)
);

create index if not exists idx_appt_pub_token_lookup on public.appointment_public_token (token);

-- -----------------------------------------------------------------------------
create or replace function public._appointment_status_id(p_name text)
returns smallint
language sql
stable
set search_path = public
as $$
  select id from public.appointment_status where name = p_name limit 1;
$$;

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

drop trigger if exists trg_appointment_notify_ai on public.appointment;
create trigger trg_appointment_notify_ai
  after insert on public.appointment
  for each row execute function public.tg_appointment_notify_after_insert();

-- -----------------------------------------------------------------------------
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

drop trigger if exists trg_appointment_notify_au on public.appointment;
create trigger trg_appointment_notify_au
  after update on public.appointment
  for each row execute function public.tg_appointment_notify_after_update();

-- -----------------------------------------------------------------------------
create or replace function public.confirm_appointment_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.appointment_public_token%rowtype;
  agendada smallint;
  confirmada smallint;
  st smallint;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  select * into tok
  from public.appointment_public_token
  where token = trim(p_token)
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  if tok.purpose <> 'confirm' then
    return json_build_object('ok', false, 'error', 'WRONG_PURPOSE');
  end if;

  if tok.used_at is not null then
    return json_build_object('ok', false, 'error', 'ALREADY_USED');
  end if;

  if tok.expires_at < now() then
    return json_build_object('ok', false, 'error', 'EXPIRED');
  end if;

  agendada := public._appointment_status_id('Agendada');
  confirmada := public._appointment_status_id('Confirmada');

  select status_id into st from public.appointment where id = tok.appointment_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  if st <> agendada then
    return json_build_object('ok', false, 'error', 'NOT_PENDING');
  end if;

  update public.appointment
  set status_id = confirmada
  where id = tok.appointment_id;

  update public.appointment_public_token
  set used_at = now()
  where id = tok.id;

  update public.appointment_notification
  set status = 'skipped',
      last_error = 'Cita confirmada por el cliente',
      updated_at = now()
  where appointment_id = tok.appointment_id
    and kind = 'CONFIRM_REMINDER'
    and status in ('pending', 'scheduled', 'sending');

  return json_build_object('ok', true, 'appointment_id', tok.appointment_id);
end;
$$;

grant execute on function public.confirm_appointment_by_token(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
create or replace function public.ensure_appointment_public_token(
  p_appointment_id uuid,
  p_purpose public.appointment_token_purpose,
  p_ttl_hours int default 168
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text;
  exp_ts timestamptz;
begin
  if p_ttl_hours < 1 or p_ttl_hours > 24 * 60 then
    p_ttl_hours := 168;
  end if;

  if not exists (select 1 from public.appointment where id = p_appointment_id) then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  select t.token into raw_token
  from public.appointment_public_token t
  where t.appointment_id = p_appointment_id
    and t.purpose = p_purpose
    and t.used_at is null
    and t.expires_at > now()
  limit 1;

  if raw_token is not null then
    return raw_token;
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  exp_ts := now() + make_interval(hours => p_ttl_hours);

  delete from public.appointment_public_token
  where appointment_id = p_appointment_id and purpose = p_purpose;

  insert into public.appointment_public_token (appointment_id, purpose, token, expires_at)
  values (p_appointment_id, p_purpose, raw_token, exp_ts);

  return raw_token;
end;
$$;

revoke all on function public.ensure_appointment_public_token(uuid, public.appointment_token_purpose, int) from public;
grant execute on function public.ensure_appointment_public_token(uuid, public.appointment_token_purpose, int) to service_role;

-- -----------------------------------------------------------------------------
create or replace function public.claim_pending_notifications(p_limit int default 20)
returns setof public.appointment_notification
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with cte as (
    select n.id
    from public.appointment_notification n
    where n.channel = 'email'
      and n.status in ('pending', 'scheduled')
      and (
        n.status = 'pending'
        or (n.status = 'scheduled' and n.scheduled_for is not null and n.scheduled_for <= now())
      )
    order by n.scheduled_for nulls first, n.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.appointment_notification u
  set status = 'sending',
      attempt_count = u.attempt_count + 1,
      updated_at = now()
  from cte
  where u.id = cte.id
  returning u.*;
end;
$$;

revoke all on function public.claim_pending_notifications(int) from public;
grant execute on function public.claim_pending_notifications(int) to service_role;

create or replace function public.finish_notification_send(
  p_id uuid,
  p_success boolean,
  p_error text,
  p_provider_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_success then
    update public.appointment_notification
    set status = 'sent',
        sent_at = now(),
        last_error = null,
        provider_message_id = p_provider_id,
        updated_at = now()
    where id = p_id;
  else
    update public.appointment_notification
    set status = 'failed',
        last_error = left(coalesce(p_error, 'Error'), 2000),
        updated_at = now()
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.finish_notification_send(uuid, boolean, text, text) from public;
grant execute on function public.finish_notification_send(uuid, boolean, text, text) to service_role;

-- -----------------------------------------------------------------------------
create or replace function public.get_public_booking_business(p_business_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', b.id,
    'name', b.name,
    'address', b.address,
    'phone', b.phone,
    'email', b.email,
    'public_booking_enabled', b.public_booking_enabled
  )
  from public.business b
  where b.id = p_business_id
    and b.active = true
    and b.public_booking_enabled = true;
$$;

grant execute on function public.get_public_booking_business(uuid) to anon, authenticated;

create or replace function public.list_booking_services(p_business_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
    'id', s.id,
    'name', s.name,
    'duration_minutes', s.duration_minutes,
    'price', s.price
  ) order by s.name), '[]'::json)
  from public.service s
  where s.business_id = p_business_id
    and s.active = true;
$$;

grant execute on function public.list_booking_services(uuid) to anon, authenticated;

create or replace function public.list_booking_staff(p_business_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
    'id', s.id,
    'name', s.name
  ) order by s.name), '[]'::json)
  from public.staff s
  where s.business_id = p_business_id
    and s.active = true;
$$;

grant execute on function public.list_booking_staff(uuid) to anon, authenticated;

create or replace function public.get_available_slots_public(
  p_business_id uuid,
  p_user_id uuid,
  p_service_id uuid,
  p_on_date date,
  p_tz text default 'America/Bogota',
  p_day_of_week smallint default null,
  p_exclude_appointment_id uuid default null
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_duration int;
  v_business uuid;
  franja record;
  v_y int;
  v_mo int;
  v_d int;
  v_dow smallint;
  v_range_start timestamptz;
  v_range_end_excl timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_win_start timestamptz;
  v_win_end timestamptz;
  v_busy boolean;
  v_out text[] := array[]::text[];
  v_label text;
  v_has_service_specific boolean;
  v_today_in_tz date;
begin
  v_business := p_business_id;

  if not exists (
    select 1 from public.service svc
    where svc.id = p_service_id and svc.business_id = v_business and svc.active is true
  ) then
    return v_out;
  end if;

  if not exists (
    select 1 from public.staff st
    where st.id = p_user_id and st.business_id = v_business and st.active is true
  ) then
    return v_out;
  end if;

  select svc.duration_minutes
    into v_duration
  from public.service svc
  where svc.id = p_service_id
    and svc.business_id = v_business
    and svc.active is true;

  if v_duration is null or v_duration < 1 then
    return v_out;
  end if;

  v_y := extract(year from p_on_date)::int;
  v_mo := extract(month from p_on_date)::int;
  v_d := extract(day from p_on_date)::int;

  if p_day_of_week is not null and p_day_of_week >= 0 and p_day_of_week <= 6 then
    v_dow := p_day_of_week;
  else
    v_dow := extract(dow from p_on_date)::smallint;
  end if;

  v_today_in_tz := (now() at time zone p_tz)::date;

  v_range_start := make_timestamptz(v_y, v_mo, v_d, 0, 0, 0::double precision, p_tz);
  v_range_end_excl := v_range_start + interval '1 day';

  select exists (
    select 1
    from public.schedule sch
    where sch.user_id = p_user_id
      and sch.day_of_week = v_dow
      and sch.service_id = p_service_id
  ) into v_has_service_specific;

  for franja in
    select sch.start_time, sch.end_time
    from public.schedule sch
    where sch.user_id = p_user_id
      and sch.day_of_week = v_dow
      and (
        case
          when v_has_service_specific then sch.service_id = p_service_id
          else sch.service_id is null
        end
      )
  loop
    v_win_start := make_timestamptz(
      v_y, v_mo, v_d,
      extract(hour from franja.start_time)::int,
      extract(minute from franja.start_time)::int,
      extract(second from franja.start_time)::numeric,
      p_tz
    );
    v_win_end := make_timestamptz(
      v_y, v_mo, v_d,
      extract(hour from franja.end_time)::int,
      extract(minute from franja.end_time)::int,
      extract(second from franja.end_time)::numeric,
      p_tz
    );

    v_slot_start := v_win_start;
    while v_slot_start + make_interval(mins => v_duration) <= v_win_end loop
      v_slot_end := v_slot_start + make_interval(mins => v_duration);

      if v_slot_start >= v_range_start and v_slot_start < v_range_end_excl then
        select exists (
          select 1
          from public.appointment a
          join public.appointment_status ast on ast.id = a.status_id
          where a.user_id = p_user_id
            and ast.name <> 'Cancelada'
            and a.start_date_time < v_slot_end
            and a.end_date_time > v_slot_start
            and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
        ) into v_busy;

        if not v_busy then
          if p_on_date = v_today_in_tz and v_slot_start <= now() then
            null;
          else
            v_label := to_char(v_slot_start at time zone p_tz, 'HH24:MI');
            if not (v_label = any (v_out)) then
              v_out := array_append(v_out, v_label);
            end if;
          end if;
        end if;
      end if;

      v_slot_start := v_slot_start + make_interval(mins => v_duration);
    end loop;
  end loop;

  return (
    select coalesce(array_agg(z order by z), array[]::text[])
    from (select distinct unnest(v_out) as z) q
  );
end;
$$;

grant execute on function public.get_available_slots_public(uuid, uuid, uuid, date, text, smallint, uuid) to anon, authenticated;

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
    notes
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
    'Reserva web'
  )
  returning id into appt_id;

  return json_build_object('ok', true, 'appointment_id', appt_id);
end;
$$;

grant execute on function public.create_public_booking_appointment(
  uuid, text, text, text, text, text, uuid, uuid, date, text, text
) to anon, authenticated;

-- -----------------------------------------------------------------------------
alter table public.business_smtp_settings enable row level security;
alter table public.appointment_notification enable row level security;
alter table public.appointment_public_token enable row level security;

drop policy if exists business_smtp_select on public.business_smtp_settings;
create policy business_smtp_select on public.business_smtp_settings
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists business_smtp_admin_all on public.business_smtp_settings;
create policy business_smtp_admin_all on public.business_smtp_settings
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_admin())
  with check (business_id = public.current_business_id());

drop policy if exists appt_notif_select on public.appointment_notification;
create policy appt_notif_select on public.appointment_notification
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists appt_notif_no_write on public.appointment_notification;
create policy appt_notif_no_write on public.appointment_notification
  for insert to authenticated
  with check (false);

drop policy if exists appt_notif_no_update on public.appointment_notification;
create policy appt_notif_no_update on public.appointment_notification
  for update to authenticated
  using (false);

drop policy if exists appt_notif_no_delete on public.appointment_notification;
create policy appt_notif_no_delete on public.appointment_notification
  for delete to authenticated
  using (false);

drop policy if exists appt_token_deny on public.appointment_public_token;
create policy appt_token_deny on public.appointment_public_token
  for all to authenticated
  using (false)
  with check (false);

-- -----------------------------------------------------------------------------
alter table public.appointment_notification replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.appointment_notification;
exception when duplicate_object then null;
end $$;

-- Validar token de reagenda (página pública)
create or replace function public.validate_reschedule_token(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tok public.appointment_public_token%rowtype;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  select * into tok
  from public.appointment_public_token
  where token = trim(p_token)
    and purpose = 'reschedule'
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  if tok.used_at is not null then
    return json_build_object('ok', false, 'error', 'ALREADY_USED');
  end if;

  if tok.expires_at < now() then
    return json_build_object('ok', false, 'error', 'EXPIRED');
  end if;

  return json_build_object(
    'ok', true,
    'appointment_id', tok.appointment_id,
    'business_id', (select business_id from public.appointment where id = tok.appointment_id)
  );
end;
$$;

grant execute on function public.validate_reschedule_token(text) to anon, authenticated;
