-- Earlier slot notifications with released-slot tracing and optimistic claim flow.
-- notification_kind value EARLIER_SLOT_AVAILABLE is added in 20260427115900_notification_kind_earlier_slot_enum.sql

do $$ begin
  create type public.released_slot_source_reason as enum ('cancelled', 'rescheduled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.released_slot_status as enum ('open', 'claimed', 'expired');
exception when duplicate_object then null;
end $$;

create table if not exists public.released_slot (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete restrict,
  service_id uuid not null references public.service (id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source_appointment_id uuid not null references public.appointment (id) on delete restrict,
  source_reason public.released_slot_source_reason not null,
  status public.released_slot_status not null default 'open',
  claimed_by_appointment_id uuid references public.appointment (id) on delete set null,
  created_at timestamptz not null default now(),
  check (start_at < end_at)
);

create index if not exists idx_released_slot_business_open_start
  on public.released_slot (business_id, status, start_at);
create index if not exists idx_released_slot_staff_open_start
  on public.released_slot (staff_id, status, start_at);

create table if not exists public.appointment_earlier_slot_opt_in (
  appointment_id uuid primary key references public.appointment (id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create index if not exists idx_appt_earlier_opt_in_enabled
  on public.appointment_earlier_slot_opt_in (enabled)
  where enabled = true;

alter table public.appointment
  add column if not exists rescheduled_from_released_slot_id uuid;

do $$ begin
  alter table public.appointment
    add constraint appointment_rescheduled_from_released_slot_fkey
    foreign key (rescheduled_from_released_slot_id)
    references public.released_slot (id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists idx_appt_rescheduled_from_released_slot
  on public.appointment (rescheduled_from_released_slot_id);

create or replace function public.tg_appointment_init_earlier_opt_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.appointment_earlier_slot_opt_in (appointment_id, enabled)
  values (new.id, false)
  on conflict (appointment_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_appointment_init_earlier_opt_in on public.appointment;
create trigger trg_appointment_init_earlier_opt_in
  after insert on public.appointment
  for each row execute function public.tg_appointment_init_earlier_opt_in();

create or replace function public.enqueue_earlier_slot_notifications(p_released_slot_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.released_slot%rowtype;
  v_count int := 0;
  v_cancelled_id smallint;
  v_completed_id smallint;
  v_noshow_id smallint;
  rec record;
  v_smtp_on boolean;
  v_email text;
begin
  if p_released_slot_id is null then
    return 0;
  end if;

  select * into v_slot
  from public.released_slot
  where id = p_released_slot_id
    and status = 'open'
  limit 1;

  if not found then
    return 0;
  end if;

  v_cancelled_id := public._appointment_status_id('Cancelada');
  v_completed_id := public._appointment_status_id('Completada');
  v_noshow_id := public._appointment_status_id('NoShow');

  for rec in
    select
      a.id as appointment_id,
      a.customer_id,
      a.start_date_time
    from public.appointment a
    join public.appointment_earlier_slot_opt_in o on o.appointment_id = a.id
    where a.business_id = v_slot.business_id
      and a.user_id = v_slot.staff_id
      and a.service_id = v_slot.service_id
      and o.enabled = true
      and a.start_date_time > now()
      and a.start_date_time > v_slot.start_at
      and (v_cancelled_id is null or a.status_id <> v_cancelled_id)
      and (v_completed_id is null or a.status_id <> v_completed_id)
      and (v_noshow_id is null or a.status_id <> v_noshow_id)
      and a.id <> v_slot.source_appointment_id
      and (a.end_date_time - a.start_date_time) <= (v_slot.end_at - v_slot.start_at)
  loop
    select nullif(trim(c.email), '') into v_email
    from public.customer c
    where c.id = rec.customer_id;

    select coalesce(s.enabled, false) into v_smtp_on
    from public.business_smtp_settings s
    where s.business_id = v_slot.business_id;

    if v_email is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        v_slot.business_id, rec.appointment_id, 'EARLIER_SLOT_AVAILABLE', 'skipped', null,
        'Sin correo del cliente',
        jsonb_build_object('reason', 'no_email', 'released_slot_id', v_slot.id::text)
      )
      on conflict do nothing;
      continue;
    end if;

    if not v_smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        v_slot.business_id, rec.appointment_id, 'EARLIER_SLOT_AVAILABLE', 'skipped', v_email,
        'SMTP desactivado o sin configurar',
        jsonb_build_object('reason', 'smtp_disabled', 'released_slot_id', v_slot.id::text)
      )
      on conflict do nothing;
      continue;
    end if;

    insert into public.appointment_notification (
      business_id, appointment_id, kind, status, recipient_email, payload_snapshot
    ) values (
      v_slot.business_id,
      rec.appointment_id,
      'EARLIER_SLOT_AVAILABLE',
      'pending',
      v_email,
      jsonb_build_object(
        'released_slot_id', v_slot.id::text,
        'released_slot_start_at', v_slot.start_at,
        'released_slot_end_at', v_slot.end_at
      )
    )
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

drop index if exists public.uniq_appt_notif_appt_kind;
create unique index if not exists uniq_appt_notif_appt_kind_single
  on public.appointment_notification (appointment_id, kind)
  where kind <> 'EARLIER_SLOT_AVAILABLE';
create unique index if not exists uniq_appt_notif_earlier_slot
  on public.appointment_notification (appointment_id, kind, (coalesce(payload_snapshot->>'released_slot_id', '')))
  where kind = 'EARLIER_SLOT_AVAILABLE';

create or replace function public.release_slot_from_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled_id smallint;
  v_released_id uuid;
begin
  v_cancelled_id := public._appointment_status_id('Cancelada');

  if tg_op = 'UPDATE' then
    if new.status_id is distinct from old.status_id and new.status_id = v_cancelled_id then
      insert into public.released_slot (
        business_id, staff_id, service_id, start_at, end_at, source_appointment_id, source_reason
      ) values (
        old.business_id, old.user_id, old.service_id, old.start_date_time, old.end_date_time, old.id, 'cancelled'
      )
      returning id into v_released_id;

      perform public.enqueue_earlier_slot_notifications(v_released_id);
      return new;
    end if;

    if (new.start_date_time is distinct from old.start_date_time or new.end_date_time is distinct from old.end_date_time)
       and old.start_date_time > now()
       and old.status_id is distinct from v_cancelled_id then
      insert into public.released_slot (
        business_id, staff_id, service_id, start_at, end_at, source_appointment_id, source_reason
      ) values (
        old.business_id, old.user_id, old.service_id, old.start_date_time, old.end_date_time, old.id, 'rescheduled'
      )
      returning id into v_released_id;

      perform public.enqueue_earlier_slot_notifications(v_released_id);
      return new;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointment_release_slot_au on public.appointment;
create trigger trg_appointment_release_slot_au
  after update on public.appointment
  for each row execute function public.release_slot_from_appointment_change();

create or replace function public.set_appointment_earlier_slot_opt_in(
  p_appointment_id uuid,
  p_enabled boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.appointment%rowtype;
  v_cust uuid;
begin
  if p_appointment_id is null then
    return json_build_object('ok', false, 'error', 'INVALID_APPOINTMENT');
  end if;

  select * into v_appt
  from public.appointment
  where id = p_appointment_id
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  v_cust := public.current_portal_customer_id();
  if v_cust is not null and v_appt.customer_id <> v_cust then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_cust is null and not public.is_admin() then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  insert into public.appointment_earlier_slot_opt_in (appointment_id, enabled, updated_by)
  values (p_appointment_id, coalesce(p_enabled, false), auth.uid())
  on conflict (appointment_id) do update
    set enabled = excluded.enabled,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.set_appointment_earlier_slot_opt_in(uuid, boolean) to authenticated;

create or replace function public.create_portal_booking_appointment(
  p_business_id uuid,
  p_pet_id uuid,
  p_service_id uuid,
  p_user_id uuid,
  p_on_date date,
  p_start_hhmm text,
  p_tz text default 'America/Bogota',
  p_notify_if_earlier_slot boolean default false
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

  insert into public.appointment_earlier_slot_opt_in (appointment_id, enabled, updated_by)
  values (appt_id, coalesce(p_notify_if_earlier_slot, false), auth.uid())
  on conflict (appointment_id) do update
    set enabled = excluded.enabled,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return json_build_object('ok', true, 'appointment_id', appt_id);
end;
$$;

grant execute on function public.create_portal_booking_appointment(
  uuid, uuid, uuid, uuid, date, text, text, boolean
) to authenticated;

create or replace function public.claim_released_slot_and_reschedule(
  p_released_slot_id uuid,
  p_appointment_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.released_slot%rowtype;
  v_appt public.appointment%rowtype;
  v_cust uuid;
  v_cancelled_id smallint;
  v_completed_id smallint;
  v_noshow_id smallint;
begin
  if p_released_slot_id is null or p_appointment_id is null then
    return json_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_slot
  from public.released_slot
  where id = p_released_slot_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  if v_slot.status <> 'open' then
    return json_build_object('ok', false, 'error', 'SLOT_ALREADY_TAKEN');
  end if;

  if v_slot.start_at <= now() then
    update public.released_slot
    set status = 'expired'
    where id = v_slot.id;
    return json_build_object('ok', false, 'error', 'SLOT_EXPIRED');
  end if;

  select * into v_appt
  from public.appointment
  where id = p_appointment_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'APPOINTMENT_NOT_FOUND');
  end if;

  v_cust := public.current_portal_customer_id();
  if v_cust is not null and v_appt.customer_id <> v_cust then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_cust is null and not public.is_admin() then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  v_cancelled_id := public._appointment_status_id('Cancelada');
  v_completed_id := public._appointment_status_id('Completada');
  v_noshow_id := public._appointment_status_id('NoShow');
  if v_appt.status_id in (v_cancelled_id, v_completed_id, v_noshow_id) then
    return json_build_object('ok', false, 'error', 'APPOINTMENT_NOT_ELIGIBLE');
  end if;

  if v_appt.business_id <> v_slot.business_id
     or v_appt.user_id <> v_slot.staff_id
     or v_appt.service_id <> v_slot.service_id then
    return json_build_object('ok', false, 'error', 'SLOT_NOT_COMPATIBLE');
  end if;

  if v_slot.start_at >= v_appt.start_date_time then
    return json_build_object('ok', false, 'error', 'NOT_EARLIER');
  end if;

  if (v_appt.end_date_time - v_appt.start_date_time) > (v_slot.end_at - v_slot.start_at) then
    return json_build_object('ok', false, 'error', 'INSUFFICIENT_DURATION');
  end if;

  update public.appointment
  set start_date_time = v_slot.start_at,
      end_date_time = v_slot.start_at + (v_appt.end_date_time - v_appt.start_date_time),
      rescheduled_from_released_slot_id = v_slot.id
  where id = v_appt.id;

  update public.released_slot
  set status = 'claimed',
      claimed_by_appointment_id = v_appt.id
  where id = v_slot.id
    and status = 'open';

  if not found then
    return json_build_object('ok', false, 'error', 'SLOT_ALREADY_TAKEN');
  end if;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.claim_released_slot_and_reschedule(uuid, uuid) to authenticated;

alter table public.released_slot enable row level security;
alter table public.appointment_earlier_slot_opt_in enable row level security;

drop policy if exists released_slot_select on public.released_slot;
create policy released_slot_select on public.released_slot
  for select to authenticated
  using (business_id = public.current_business_id() or business_id = public.current_portal_business_id());

drop policy if exists released_slot_write_deny on public.released_slot;
create policy released_slot_write_deny on public.released_slot
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists appt_earlier_opt_in_select on public.appointment_earlier_slot_opt_in;
create policy appt_earlier_opt_in_select on public.appointment_earlier_slot_opt_in
  for select to authenticated
  using (
    exists (
      select 1
      from public.appointment a
      where a.id = appointment_id
        and (
          a.business_id = public.current_business_id()
          or a.customer_id = public.current_portal_customer_id()
        )
    )
  );

drop policy if exists appt_earlier_opt_in_no_write on public.appointment_earlier_slot_opt_in;
create policy appt_earlier_opt_in_no_write on public.appointment_earlier_slot_opt_in
  for all to authenticated
  using (false)
  with check (false);
