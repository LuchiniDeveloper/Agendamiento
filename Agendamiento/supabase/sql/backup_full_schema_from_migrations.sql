-- =============================================================================
-- Agendamiento — BACKUP DE ESQUEMA (desde migraciones)
-- =============================================================================
-- Generado: 2026-04-15 16:25 (concatenación ordenada de supabase/migrations/*.sql)
-- Contiene: TODO el DDL/versionado del proyecto (tablas, funciones, RLS, triggers, etc.)
--
-- NO incluye por sí mismo:
--   • Datos de tablas (negocio, auth.users, storage) — usar pg_dump / supabase db dump / MCP execute_sql
--   • Código de Edge Functions (está en supabase/functions/)
--
-- Restauración en proyecto NUEVO vacío (solo postgres + extensiones típicas Supabase):
--   Ejecutar en SQL Editor como postgres, o: psql \ -f este archivo
-- =============================================================================


-- #############################################################################
-- FILE: 20260403000000_initial_schema.sql
-- #############################################################################

-- Vet clinic MVP schema (multi-tenant via business_id + staff linked to auth.users)
-- Run in Supabase SQL editor or via CLI: supabase db push

-- Extensions
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Lookup tables
-- -----------------------------------------------------------------------------
create table public.role (
  id smallserial primary key,
  name text not null unique
);

create table public.appointment_status (
  id smallserial primary key,
  name text not null unique
);

insert into public.role (name) values
  ('Admin'),
  ('Veterinario'),
  ('Recepcionista')
on conflict (name) do nothing;

insert into public.appointment_status (name) values
  ('Agendada'),
  ('Confirmada'),
  ('Cancelada'),
  ('Completada'),
  ('NoShow')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- Business
-- -----------------------------------------------------------------------------
create table public.business (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  address text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Staff (replaces User; id = auth.users.id)
-- -----------------------------------------------------------------------------
create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  business_id uuid not null references public.business (id) on delete cascade,
  role_id smallint not null references public.role (id),
  name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_staff_business on public.staff (business_id);

-- -----------------------------------------------------------------------------
-- Domain tables
-- -----------------------------------------------------------------------------
create table public.customer (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_customer_business_phone on public.customer (business_id, phone);

create table public.pet (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer (id) on delete cascade,
  name text not null,
  species text,
  breed text,
  gender text,
  birth_date date,
  weight numeric(10,2),
  color text,
  notes text
);

create index idx_pet_customer on public.pet (customer_id);

create table public.service (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name text not null,
  description text,
  duration_minutes int not null default 30,
  price numeric(12,2) not null default 0,
  active boolean not null default true
);

create index idx_service_business on public.service (business_id);

-- Availability: staff member + optional service, day of week 0=Sunday .. 6=Saturday
create table public.schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff (id) on delete cascade,
  service_id uuid references public.service (id) on delete set null,
  day_of_week smallint not null check (day_of_week >= 0 and day_of_week <= 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);

create index idx_schedule_user on public.schedule (user_id);

create table public.appointment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  customer_id uuid not null references public.customer (id) on delete restrict,
  pet_id uuid not null references public.pet (id) on delete restrict,
  service_id uuid not null references public.service (id) on delete restrict,
  user_id uuid not null references public.staff (id) on delete restrict,
  start_date_time timestamptz not null,
  end_date_time timestamptz not null,
  status_id smallint not null references public.appointment_status (id),
  notes text,
  created_at timestamptz not null default now(),
  check (start_date_time < end_date_time)
);

create index idx_appointment_business_start on public.appointment (business_id, start_date_time);
create index idx_appointment_user_start on public.appointment (user_id, start_date_time);

create table public.payment (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointment (id) on delete cascade,
  amount numeric(12,2) not null,
  payment_method text not null check (payment_method in ('Cash', 'Card', 'Transfer')),
  status text not null default 'Completed',
  created_at timestamptz not null default now()
);

create index idx_payment_appointment on public.payment (appointment_id);

create table public.medical_record (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pet (id) on delete cascade,
  appointment_id uuid references public.appointment (id) on delete set null,
  diagnosis text,
  treatment text,
  observations text,
  weight numeric(10,2),
  next_visit_date date,
  created_at timestamptz not null default now()
);

create index idx_medical_pet on public.medical_record (pet_id);

create table public.reminder (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointment (id) on delete cascade,
  sent boolean not null default false,
  sent_at timestamptz,
  method text not null default 'WhatsApp' check (method in ('WhatsApp', 'Email'))
);

create index idx_reminder_appointment on public.reminder (appointment_id);

-- -----------------------------------------------------------------------------
-- Helpers for RLS
-- -----------------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.business_id
  from public.staff s
  where s.id = auth.uid() and s.active = true
  limit 1;
$$;

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.staff s
  join public.role r on r.id = s.role_id
  where s.id = auth.uid() and s.active = true
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_name() = 'Admin', false);
$$;

-- Default business_id on insert from JWT user
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
  if bid is null then
    raise exception 'No active staff profile';
  end if;
  if tg_table_name = 'customer' or tg_table_name = 'service' or tg_table_name = 'appointment' then
    new.business_id := bid;
  end if;
  return new;
end;
$$;

create trigger trg_customer_business
  before insert on public.customer
  for each row execute function public.set_business_id_from_staff();

create trigger trg_service_business
  before insert on public.service
  for each row execute function public.set_business_id_from_staff();

create trigger trg_appointment_business
  before insert on public.appointment
  for each row execute function public.set_business_id_from_staff();

-- -----------------------------------------------------------------------------
-- Reporting RPC (aggregates; RLS-safe via business check inside)
-- -----------------------------------------------------------------------------
create or replace function public.get_kpis(p_from timestamptz, p_to timestamptz)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  completed_id smallint;
begin
  if bid is null then
    return '{}'::json;
  end if;
  select id into completed_id from public.appointment_status where name = 'Completada' limit 1;

  return json_build_object(
    'revenue', (
      select coalesce(sum(pay.amount), 0)
      from public.payment pay
      join public.appointment a on a.id = pay.appointment_id
      where a.business_id = bid
        and pay.created_at >= p_from and pay.created_at < p_to
    ),
    'appointments_completed', (
      select count(*)::int from public.appointment a
      where a.business_id = bid and a.status_id = completed_id
        and a.start_date_time >= p_from and a.start_date_time < p_to
    ),
    'appointments_by_status', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select ast.name as status_name, count(*)::int as cnt
        from public.appointment a
        join public.appointment_status ast on ast.id = a.status_id
        where a.business_id = bid
          and a.start_date_time >= p_from and a.start_date_time < p_to
        group by ast.name
      ) t
    )
  );
end;
$$;

grant execute on function public.get_kpis(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.business enable row level security;
alter table public.staff enable row level security;
alter table public.role enable row level security;
alter table public.appointment_status enable row level security;
alter table public.customer enable row level security;
alter table public.pet enable row level security;
alter table public.service enable row level security;
alter table public.schedule enable row level security;
alter table public.appointment enable row level security;
alter table public.payment enable row level security;
alter table public.medical_record enable row level security;
alter table public.reminder enable row level security;

-- Lookups: any authenticated user can read
create policy role_read on public.role for select to authenticated using (true);
create policy appointment_status_read on public.appointment_status for select to authenticated using (true);

-- Business: members read; admin update
create policy business_select on public.business for select to authenticated
  using (id = public.current_business_id());
create policy business_update on public.business for update to authenticated
  using (id = public.current_business_id() and public.is_admin())
  with check (id = public.current_business_id());

-- Staff
create policy staff_select on public.staff for select to authenticated
  using (business_id = public.current_business_id());
create policy staff_insert on public.staff for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_admin());
create policy staff_update on public.staff for update to authenticated
  using (business_id = public.current_business_id() and public.is_admin())
  with check (business_id = public.current_business_id());
-- Allow user to read/update own row (name, phone) — optional; keep simple: admin manages all
create policy staff_self_read on public.staff for select to authenticated
  using (id = auth.uid());

-- Customer
create policy customer_all on public.customer for all to authenticated
  using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

-- Pet (via customer business)
create policy pet_all on public.pet for all to authenticated
  using (
    exists (
      select 1 from public.customer c
      where c.id = pet.customer_id and c.business_id = public.current_business_id()
    )
  )
  with check (
    exists (
      select 1 from public.customer c
      where c.id = pet.customer_id and c.business_id = public.current_business_id()
    )
  );

-- Service
create policy service_all on public.service for all to authenticated
  using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

-- Schedule: same business as staff user_id
create policy schedule_all on public.schedule for all to authenticated
  using (
    exists (
      select 1 from public.staff s
      where s.id = schedule.user_id and s.business_id = public.current_business_id()
    )
  )
  with check (
    exists (
      select 1 from public.staff s
      where s.id = schedule.user_id and s.business_id = public.current_business_id()
    )
  );

-- Appointment
create policy appointment_all on public.appointment for all to authenticated
  using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

-- Payment / reminder / medical_record via appointment
create policy payment_all on public.payment for all to authenticated
  using (
    exists (
      select 1 from public.appointment a
      where a.id = payment.appointment_id and a.business_id = public.current_business_id()
    )
  )
  with check (
    exists (
      select 1 from public.appointment a
      where a.id = payment.appointment_id and a.business_id = public.current_business_id()
    )
  );

create policy reminder_all on public.reminder for all to authenticated
  using (
    exists (
      select 1 from public.appointment a
      where a.id = reminder.appointment_id and a.business_id = public.current_business_id()
    )
  )
  with check (
    exists (
      select 1 from public.appointment a
      where a.id = reminder.appointment_id and a.business_id = public.current_business_id()
    )
  );

-- Medical: Veterinario/Admin write; Recepcionista read-only — simplified: all staff CRUD same business
create policy medical_select on public.medical_record for select to authenticated
  using (
    exists (
      select 1 from public.pet p
      join public.customer c on c.id = p.customer_id
      where p.id = medical_record.pet_id and c.business_id = public.current_business_id()
    )
  );

create policy medical_insert on public.medical_record for insert to authenticated
  with check (
    exists (
      select 1 from public.pet p
      join public.customer c on c.id = p.customer_id
      where p.id = medical_record.pet_id and c.business_id = public.current_business_id()
    )
    and (public.current_role_name() in ('Admin', 'Veterinario'))
  );

create policy medical_update on public.medical_record for update to authenticated
  using (
    exists (
      select 1 from public.pet p
      join public.customer c on c.id = p.customer_id
      where p.id = medical_record.pet_id and c.business_id = public.current_business_id()
    )
    and (public.current_role_name() in ('Admin', 'Veterinario'))
  )
  with check (
    exists (
      select 1 from public.pet p
      join public.customer c on c.id = p.customer_id
      where p.id = medical_record.pet_id and c.business_id = public.current_business_id()
    )
  );

create policy medical_delete on public.medical_record for delete to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.pet p
      join public.customer c on c.id = p.customer_id
      where p.id = medical_record.pet_id and c.business_id = public.current_business_id()
    )
  );

-- Bootstrap: first authenticated user creates clinic + becomes Admin (no staff row yet)
create or replace function public.bootstrap_clinic(p_business_name text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  admin_role smallint;
  disp text;
begin
  if exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'Ya existe perfil de staff para este usuario';
  end if;
  select id into admin_role from public.role where name = 'Admin' limit 1;
  disp := coalesce(nullif(trim(p_display_name), ''), split_part(auth.jwt() ->> 'email', '@', 1), 'Admin');
  insert into public.business (name) values (p_business_name) returning id into bid;
  insert into public.staff (id, business_id, role_id, name)
  values (auth.uid(), bid, admin_role, disp);
  return bid;
end;
$$;

grant execute on function public.bootstrap_clinic(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Manual alternative: create business + staff in SQL editor with service role.
-- -----------------------------------------------------------------------------


-- #############################################################################
-- FILE: 20260403120000_service_description_max_250.sql
-- #############################################################################

-- Límite de descripción de servicio (alineado con el formulario)
alter table public.service
  add constraint service_description_max_250
  check (description is null or char_length(description) <= 250);


-- #############################################################################
-- FILE: 20260403130000_staff_email_bootstrap.sql
-- #############################################################################

-- Email en staff (sincronizado al invitar / bootstrap; legado puede quedar null)
alter table public.staff
  add column if not exists email text;

create or replace function public.bootstrap_clinic(p_business_name text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  admin_role smallint;
  disp text;
  em text;
begin
  if exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'Ya existe perfil de staff para este usuario';
  end if;
  select id into admin_role from public.role where name = 'Admin' limit 1;
  disp := coalesce(nullif(trim(p_display_name), ''), split_part(auth.jwt() ->> 'email', '@', 1), 'Admin');
  em := nullif(trim(auth.jwt() ->> 'email'), '');
  insert into public.business (name) values (p_business_name) returning id into bid;
  insert into public.staff (id, business_id, role_id, name, email)
  values (auth.uid(), bid, admin_role, disp, em);
  return bid;
end;
$$;

-- Rellenar correo desde auth para filas existentes
update public.staff s
set email = u.email
from auth.users u
where u.id = s.id
  and (s.email is null or s.email = '');


-- #############################################################################
-- FILE: 20260404120000_onboarding_list_join_clinic.sql
-- #############################################################################

-- Ver clínicas activas solo si el usuario aún no tiene perfil staff (onboarding)
create policy business_select_unassigned on public.business for select to authenticated
  using (
    not exists (select 1 from public.staff s where s.id = auth.uid())
    and active = true
  );

-- Unirse a una clínica existente (rol Recepcionista; un admin puede cambiar el rol después)
create or replace function public.join_clinic(p_business_id uuid, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  receptionist_role smallint;
  disp text;
begin
  if exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'Ya existe perfil de staff para este usuario';
  end if;
  if not exists (select 1 from public.business where id = p_business_id and active = true) then
    raise exception 'Clínica no encontrada o inactiva';
  end if;
  select id into receptionist_role from public.role where name = 'Recepcionista' limit 1;
  disp := coalesce(nullif(trim(p_display_name), ''), split_part(auth.jwt() ->> 'email', '@', 1), 'Usuario');
  insert into public.staff (id, business_id, role_id, name)
  values (auth.uid(), p_business_id, receptionist_role, disp);
end;
$$;

grant execute on function public.join_clinic(uuid, text) to authenticated;


-- #############################################################################
-- FILE: 20260406120000_clients_services_agenda_rules.sql
-- #############################################################################

-- Pet delete: block when clinical history exists (defense in depth with app checks)
create or replace function public.prevent_pet_delete_if_medical()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from public.medical_record m where m.pet_id = old.id) then
    raise exception 'PET_HAS_MEDICAL_HISTORY'
      using hint = 'No se puede eliminar una mascota con historial clínico';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pet_delete_medical_guard on public.pet;
create trigger trg_pet_delete_medical_guard
  before delete on public.pet
  for each row execute function public.prevent_pet_delete_if_medical();

-- One schedule row per (vet, day, service) including NULL service as its own key
create unique index if not exists idx_schedule_user_day_service_unique
  on public.schedule (user_id, day_of_week, service_id)
  nulls not distinct;

-- Index-friendly clinical history by pet + time
create index if not exists idx_medical_record_pet_created
  on public.medical_record (pet_id, created_at desc);

-- Available slots for agenda: service windows minus busy appointments (excl. Cancelada)
create or replace function public.get_available_slots(
  p_user_id uuid,
  p_service_id uuid,
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_day_of_week smallint,
  p_tz text default 'America/Bogota'
)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_duration int;
  v_business uuid;
  s record;
  v_y int;
  v_mo int;
  v_d int;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_win_start timestamptz;
  v_win_end timestamptz;
  v_busy boolean;
  v_out text[] := array[]::text[];
  v_label text;
begin
  v_business := public.current_business_id();
  if v_business is null then
    return v_out;
  end if;

  select s.duration_minutes
    into v_duration
  from public.service s
  where s.id = p_service_id
    and s.business_id = v_business
    and s.active is true;

  if v_duration is null or v_duration < 1 then
    return v_out;
  end if;

  v_y := (extract(year from (p_day_start at time zone p_tz)))::int;
  v_mo := (extract(month from (p_day_start at time zone p_tz)))::int;
  v_d := (extract(day from (p_day_start at time zone p_tz)))::int;

  for s in
    select sch.start_time, sch.end_time
    from public.schedule sch
    where sch.user_id = p_user_id
      and sch.day_of_week = p_day_of_week
      and (sch.service_id is null or sch.service_id = p_service_id)
  loop
    v_win_start := make_timestamptz(
      v_y, v_mo, v_d,
      extract(hour from s.start_time)::int,
      extract(minute from s.start_time)::int,
      extract(second from s.start_time)::numeric,
      p_tz
    );
    v_win_end := make_timestamptz(
      v_y, v_mo, v_d,
      extract(hour from s.end_time)::int,
      extract(minute from s.end_time)::int,
      extract(second from s.end_time)::numeric,
      p_tz
    );

    v_slot_start := v_win_start;
    while v_slot_start + make_interval(mins => v_duration) <= v_win_end loop
      v_slot_end := v_slot_start + make_interval(mins => v_duration);

      if v_slot_start >= p_day_start and v_slot_start < p_day_end then
        select exists (
          select 1
          from public.appointment a
          join public.appointment_status ast on ast.id = a.status_id
          where a.user_id = p_user_id
            and ast.name <> 'Cancelada'
            and a.start_date_time < v_slot_end
            and a.end_date_time > v_slot_start
        ) into v_busy;

        if not v_busy then
          v_label := to_char(v_slot_start at time zone p_tz, 'HH24:MI');
          if not (v_label = any (v_out)) then
            v_out := array_append(v_out, v_label);
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

grant execute on function public.get_available_slots(
  uuid, uuid, timestamptz, timestamptz, smallint, text
) to authenticated;


-- #############################################################################
-- FILE: 20260406190000_fix_get_available_slots_calendar_date.sql
-- #############################################################################

-- Huecos de agenda: usar fecha calendario + TZ clínica (evita desfase JS UTC vs día/semana)
drop function if exists public.get_available_slots(uuid, uuid, timestamptz, timestamptz, smallint, text);

create or replace function public.get_available_slots(
  p_user_id uuid,
  p_service_id uuid,
  p_on_date date,
  p_tz text default 'America/Bogota'
)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_duration int;
  v_business uuid;
  s record;
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
begin
  v_business := public.current_business_id();
  if v_business is null then
    return v_out;
  end if;

  select s.duration_minutes
    into v_duration
  from public.service s
  where s.id = p_service_id
    and s.business_id = v_business
    and s.active is true;

  if v_duration is null or v_duration < 1 then
    return v_out;
  end if;

  v_y := extract(year from p_on_date)::int;
  v_mo := extract(month from p_on_date)::int;
  v_d := extract(day from p_on_date)::int;
  -- Mismo convención que JS getDay(): domingo=0 … sábado=6
  v_dow := extract(dow from p_on_date)::smallint;

  v_range_start := make_timestamptz(v_y, v_mo, v_d, 0, 0, 0::double precision, p_tz);
  v_range_end_excl := v_range_start + interval '1 day';

  for s in
    select sch.start_time, sch.end_time
    from public.schedule sch
    where sch.user_id = p_user_id
      and sch.day_of_week = v_dow
      and (sch.service_id is null or sch.service_id = p_service_id)
  loop
    v_win_start := make_timestamptz(
      v_y, v_mo, v_d,
      extract(hour from s.start_time)::int,
      extract(minute from s.start_time)::int,
      extract(second from s.start_time)::numeric,
      p_tz
    );
    v_win_end := make_timestamptz(
      v_y, v_mo, v_d,
      extract(hour from s.end_time)::int,
      extract(minute from s.end_time)::int,
      extract(second from s.end_time)::numeric,
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
        ) into v_busy;

        if not v_busy then
          v_label := to_char(v_slot_start at time zone p_tz, 'HH24:MI');
          if not (v_label = any (v_out)) then
            v_out := array_append(v_out, v_label);
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

grant execute on function public.get_available_slots(uuid, uuid, date, text) to authenticated;


-- #############################################################################
-- FILE: 20260406200000_get_available_slots_robust.sql
-- #############################################################################

-- Corrige huecos disponibles: alias/record sin choque en plpgsql, fallback si no hay fila estricta,
-- y p_day_of_week desde el cliente (misma convención que el formulario de franjas).
drop function if exists public.get_available_slots(uuid, uuid, date, text, smallint);
drop function if exists public.get_available_slots(uuid, uuid, date, text);
drop function if exists public.get_available_slots(uuid, uuid, timestamptz, timestamptz, smallint, text);

create or replace function public.get_available_slots(
  p_user_id uuid,
  p_service_id uuid,
  p_on_date date,
  p_tz text default 'America/Bogota',
  p_day_of_week smallint default null
)
returns text[]
language plpgsql
stable
security invoker
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
  v_strict_exists boolean;
begin
  v_business := public.current_business_id();
  if v_business is null then
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

  v_range_start := make_timestamptz(v_y, v_mo, v_d, 0, 0, 0::double precision, p_tz);
  v_range_end_excl := v_range_start + interval '1 day';

  select exists (
    select 1
    from public.schedule sch
    where sch.user_id = p_user_id
      and sch.day_of_week = v_dow
      and (sch.service_id is null or sch.service_id = p_service_id)
  ) into v_strict_exists;

  for franja in
    select sch.start_time, sch.end_time
    from public.schedule sch
    where sch.user_id = p_user_id
      and sch.day_of_week = v_dow
      and (
        not v_strict_exists
        or sch.service_id is null
        or sch.service_id = p_service_id
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
        ) into v_busy;

        if not v_busy then
          v_label := to_char(v_slot_start at time zone p_tz, 'HH24:MI');
          if not (v_label = any (v_out)) then
            v_out := array_append(v_out, v_label);
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

grant execute on function public.get_available_slots(uuid, uuid, date, text, smallint) to authenticated;


-- #############################################################################
-- FILE: 20260406210000_get_available_slots_service_priority.sql
-- #############################################################################

-- Prioridad de franjas: si existe horario específico para el servicio (mismo vet + día),
-- solo se usan esas ventanas. Si no, solo "Cualquiera" (service_id null).
-- Ej.: Lun Cualquiera 8–17 + Baño 8–11 → Baño solo hasta 11; otros servicios 8–17.
create or replace function public.get_available_slots(
  p_user_id uuid,
  p_service_id uuid,
  p_on_date date,
  p_tz text default 'America/Bogota',
  p_day_of_week smallint default null
)
returns text[]
language plpgsql
stable
security invoker
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
begin
  v_business := public.current_business_id();
  if v_business is null then
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
        ) into v_busy;

        if not v_busy then
          v_label := to_char(v_slot_start at time zone p_tz, 'HH24:MI');
          if not (v_label = any (v_out)) then
            v_out := array_append(v_out, v_label);
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


-- #############################################################################
-- FILE: 20260406230000_get_available_slots_exclude_appointment.sql
-- #############################################################################

-- Al reprogramar, excluir la propia cita del chequeo de ocupación.
create or replace function public.get_available_slots(
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
security invoker
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
begin
  v_business := public.current_business_id();
  if v_business is null then
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
          v_label := to_char(v_slot_start at time zone p_tz, 'HH24:MI');
          if not (v_label = any (v_out)) then
            v_out := array_append(v_out, v_label);
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


-- #############################################################################
-- FILE: 20260406240000_get_available_slots_skip_past_today.sql
-- #############################################################################

-- Si la cita es para el día calendario actual (en p_tz), no ofrecer horarios ya pasados.
create or replace function public.get_available_slots(
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
security invoker
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
  v_business := public.current_business_id();
  if v_business is null then
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


-- #############################################################################
-- FILE: 20260407120000_reports_rpcs.sql
-- #############################################################################

-- Report RPCs: security definer + current_business_id(), same pattern as get_kpis.
-- Timezone: p_tz default America/Bogota for labels and bucketing where noted.

-- -----------------------------------------------------------------------------
-- 1) Ingresos por servicio y período
-- Revenue and counts attributed to appointment start_date_time; only Completada for money/citas.
-- -----------------------------------------------------------------------------
create or replace function public.report_revenue_by_service(
  p_from timestamptz,
  p_to timestamptz,
  p_grain text,
  p_payment_method text default null,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  v_grain text := lower(trim(p_grain));
  completed_id smallint;
begin
  if bid is null then
    return '[]'::json;
  end if;
  if v_grain not in ('day', 'week', 'month') then
    v_grain := 'month';
  end if;
  select id into completed_id from public.appointment_status where name = 'Completada' limit 1;

  return (
    with ap as (
      select
        a.id,
        a.service_id,
        s.name as service_name,
        date_trunc(v_grain, (a.start_date_time at time zone p_tz)::timestamp) as period_ts,
        coalesce(pay.amount, 0)::numeric as pay_amt,
        pay.payment_method::text as pay_method,
        pay.id as pay_id
      from public.appointment a
      join public.service s on s.id = a.service_id
      left join public.payment pay on pay.appointment_id = a.id
        and (
          p_payment_method is null
          or trim(p_payment_method) = ''
          or pay.payment_method::text = trim(p_payment_method)
        )
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and a.status_id = completed_id
        and (
          p_payment_method is null
          or trim(p_payment_method) = ''
          or exists (
            select 1
            from public.payment px
            where px.appointment_id = a.id
              and px.payment_method::text = trim(p_payment_method)
          )
        )
    ),
    agg as (
      select
        period_ts,
        service_name,
        count(distinct id)::int as total_citas_completadas,
        coalesce(sum(pay_amt), 0)::numeric as ingresos_brutos
      from ap
      group by period_ts, service_name
    ),
    with_pct as (
      select
        a.*,
        case when a.total_citas_completadas > 0
          then a.ingresos_brutos / a.total_citas_completadas
          else 0::numeric
        end as ingreso_promedio_por_cita,
        sum(a.ingresos_brutos) over () as grand_total
      from agg a
    ),
    dominant as (
      select distinct on (sub.period_ts, sub.service_name)
        sub.period_ts,
        sub.service_name,
        sub.pay_method as metodo_pago_principal
      from (
        select
          ap.period_ts,
          ap.service_name,
          ap.pay_method,
          sum(ap.pay_amt) as sm
        from ap
        where ap.pay_id is not null
        group by ap.period_ts, ap.service_name, ap.pay_method
      ) sub
      order by sub.period_ts, sub.service_name, sub.sm desc, sub.pay_method
    ),
    labels as (
      select
        w.*,
        case v_grain
          when 'day' then to_char((w.period_ts at time zone p_tz)::date, 'YYYY-MM-DD')
          when 'month' then to_char((w.period_ts at time zone p_tz)::date, 'YYYY-MM')
          else to_char((w.period_ts at time zone p_tz)::date, 'IYYY-"W"IW')
        end as periodo,
        case when w.grand_total > 0
          then round((100.0 * w.ingresos_brutos / w.grand_total)::numeric, 1)
          else 0::numeric
        end as pct_del_total
      from with_pct w
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_ts, ord_svc)
        from (
          select
            l.period_ts as ord_ts,
            l.service_name as ord_svc,
            json_build_object(
              'periodo', l.periodo,
              'servicio', l.service_name,
              'total_citas_completadas', l.total_citas_completadas,
              'ingresos_brutos', l.ingresos_brutos,
              'ingreso_promedio_por_cita', l.ingreso_promedio_por_cita,
              'metodo_pago_principal', coalesce(d.metodo_pago_principal, '—'),
              'pct_del_total', l.pct_del_total
            ) as row_json
          from labels l
          left join dominant d on d.period_ts = l.period_ts and d.service_name = l.service_name
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Productividad por staff
-- -----------------------------------------------------------------------------
create or replace function public.report_staff_productivity(
  p_from timestamptz,
  p_to timestamptz,
  p_role text default null,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with st as (
      select s.id, s.name, r.name as role_name
      from public.staff s
      join public.role r on r.id = s.role_id
      where s.business_id = bid
        and s.active is true
        and (
          p_role is null
          or trim(p_role) = ''
          or trim(p_role) = 'Todos'
          or r.name = p_role
        )
    ),
    ap as (
      select
        a.user_id,
        ast.name as st_name,
        a.id as ap_id,
        extract(epoch from (a.end_date_time - a.start_date_time)) / 60.0 as dur_min
      from public.appointment a
      join public.appointment_status ast on ast.id = a.status_id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
    ),
    pay_tot as (
      select a.user_id, sum(p.amount)::numeric as amt
      from public.appointment a
      join public.payment p on p.appointment_id = a.id
      join public.appointment_status ast on ast.id = a.status_id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and ast.name = 'Completada'
      group by a.user_id
    ),
    stats as (
      select
        st.id as staff_id,
        st.name as staff_nombre,
        st.role_name as rol,
        count(ap.ap_id)::int as citas_agendadas,
        count(*) filter (where ap.st_name = 'Completada')::int as citas_completadas,
        count(*) filter (where ap.st_name = 'Cancelada')::int as canceladas,
        count(*) filter (where ap.st_name = 'NoShow')::int as no_show,
        coalesce(max(pt.amt), 0::numeric) as ingresos_generados,
        avg(ap.dur_min) filter (where ap.st_name = 'Completada') as dur_avg
      from st
      left join ap on ap.user_id = st.id
      left join pay_tot pt on pt.user_id = st.id
      group by st.id, st.name, st.role_name
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_name)
        from (
          select
            s.staff_nombre as ord_name,
            json_build_object(
              'staff_nombre', s.staff_nombre,
              'rol', s.rol,
              'citas_agendadas', coalesce(s.citas_agendadas, 0),
              'citas_completadas', coalesce(s.citas_completadas, 0),
              'canceladas', coalesce(s.canceladas, 0),
              'no_show', coalesce(s.no_show, 0),
              'tasa_completitud',
                case when coalesce(s.citas_agendadas, 0) > 0
                  then round((100.0 * s.citas_completadas / s.citas_agendadas)::numeric, 1)
                  else 0::numeric
                end,
              'ingresos_generados', coalesce(s.ingresos_generados, 0),
              'duracion_promedio_min',
                case
                  when s.dur_avg is null then null
                  else round(s.dur_avg::numeric, 1)
                end
            ) as row_json
          from stats s
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) Retención y valor de clientes
-- -----------------------------------------------------------------------------
create or replace function public.report_customer_retention(
  p_from timestamptz,
  p_to timestamptz,
  p_min_citas int default 1,
  p_segment text default null,
  p_inactive_days int default 120,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with cust as (
      select c.id, c.name, c.phone, c.email
      from public.customer c
      where c.business_id = bid
    ),
    pets as (
      select p.customer_id, count(*)::int as n
      from public.pet p
      join cust on cust.id = p.customer_id
      group by p.customer_id
    ),
    ap_stats as (
      select
        a.customer_id,
        count(*)::int as total_citas,
        max(a.start_date_time) as ultima_cita,
        min(a.start_date_time) as primera_cita
      from public.appointment a
      where a.business_id = bid
      group by a.customer_id
    ),
    paid as (
      select
        a.customer_id,
        coalesce(sum(pay.amount), 0)::numeric as total_pagado
      from public.appointment a
      join public.payment pay on pay.appointment_id = a.id
      where a.business_id = bid
      group by a.customer_id
    ),
    base as (
      select
        c.id,
        c.name as cliente_nombre,
        c.phone as telefono,
        c.email as email,
        coalesce(pt.n, 0)::int as total_mascotas,
        coalesce(st.total_citas, 0)::int as total_citas,
        st.ultima_cita,
        st.primera_cita,
        coalesce(pd.total_pagado, 0)::numeric as total_pagado,
        case
          when st.ultima_cita is null then null::int
          else (current_date - (st.ultima_cita at time zone p_tz)::date)::int
        end as dias_sin_visita,
        case
          when st.ultima_cita is not null
            and (current_date - (st.ultima_cita at time zone p_tz)::date) > p_inactive_days
          then 'Inactivo'
          when st.primera_cita is not null
            and st.primera_cita >= p_from
            and st.primera_cita <= p_to
          then 'Nuevo'
          when st.ultima_cita is null then 'Nuevo'
          else 'Recurrente'
        end::text as segmento
      from cust c
      left join pets pt on pt.customer_id = c.id
      left join ap_stats st on st.customer_id = c.id
      left join paid pd on pd.customer_id = c.id
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_name)
        from (
          select
            b.cliente_nombre as ord_name,
            json_build_object(
              'cliente_nombre', b.cliente_nombre,
              'telefono', coalesce(b.telefono, '—'),
              'email', coalesce(b.email, '—'),
              'total_mascotas', b.total_mascotas,
              'total_citas', b.total_citas,
              'ultima_cita',
                case
                  when b.ultima_cita is null then '—'
                  else to_char((b.ultima_cita at time zone p_tz)::date, 'YYYY-MM-DD')
                end,
              'total_pagado', b.total_pagado,
              'segmento', b.segmento,
              'dias_sin_visita', coalesce(b.dias_sin_visita, 0)
            ) as row_json
          from base b
          where b.total_citas >= p_min_citas
            and (
              p_segment is null
              or trim(p_segment) = ''
              or b.segmento = trim(p_segment)
            )
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Cancelaciones y no-shows (detalle)
-- -----------------------------------------------------------------------------
create or replace function public.report_cancellations(
  p_from timestamptz,
  p_to timestamptz,
  p_estado text default 'Ambos',
  p_tz text default 'America/Bogota',
  p_limit int default 500,
  p_offset int default 0
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  v_estado text := trim(coalesce(p_estado, 'Ambos'));
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with base as (
      select
        a.id,
        (a.start_date_time at time zone p_tz)::date as d,
        to_char(a.start_date_time at time zone p_tz, 'HH24:MI') as hora,
        sv.name as servicio,
        c.name as cliente,
        p.name as mascota,
        st.name as staff,
        ast.name as estado,
        coalesce(rem.sent, false) as rem_sent
      from public.appointment a
      join public.appointment_status ast on ast.id = a.status_id
      join public.service sv on sv.id = a.service_id
      join public.customer c on c.id = a.customer_id
      join public.pet p on p.id = a.pet_id
      join public.staff st on st.id = a.user_id
      left join lateral (
        select r.sent
        from public.reminder r
        where r.appointment_id = a.id
        order by r.sent desc nulls last
        limit 1
      ) rem on true
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and ast.name in ('Cancelada', 'NoShow')
        and (
          v_estado = 'Ambos'
          or (v_estado = 'Cancelada' and ast.name = 'Cancelada')
          or (v_estado = 'NoShow' and ast.name = 'NoShow')
        )
      order by a.start_date_time desc
      limit least(greatest(p_limit, 1), 10000)
      offset greatest(p_offset, 0)
    )
    select coalesce(
      json_agg(
        json_build_object(
          'fecha', to_char(b.d, 'YYYY-MM-DD'),
          'dia_semana',
            case extract(dow from b.d)
              when 0 then 'Domingo'
              when 1 then 'Lunes'
              when 2 then 'Martes'
              when 3 then 'Miércoles'
              when 4 then 'Jueves'
              when 5 then 'Viernes'
              else 'Sábado'
            end,
          'hora', b.hora,
          'servicio', b.servicio,
          'cliente', b.cliente,
          'mascota', b.mascota,
          'staff', b.staff,
          'estado', b.estado,
          'recordatorio_enviado', case when b.rem_sent then 'Sí' else 'No' end
        )
        order by b.d desc, b.hora desc
      ),
      '[]'::json
    )
    from base b
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Historial clínico
-- -----------------------------------------------------------------------------
create or replace function public.report_medical_history(
  p_from timestamptz,
  p_to timestamptz,
  p_species text default null,
  p_breed text default null,
  p_tz text default 'America/Bogota',
  p_limit int default 500,
  p_offset int default 0
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with base as (
      select
        m.id,
        pet.name as mascota,
        pet.species as especie,
        pet.breed as raza,
        pet.birth_date,
        coalesce(m.weight, pet.weight) as peso_kg,
        m.diagnosis,
        m.treatment,
        m.next_visit_date,
        m.created_at as consulta_at,
        st.name as vet_name
      from public.medical_record m
      join public.pet pet on pet.id = m.pet_id
      join public.customer cu on cu.id = pet.customer_id
      left join public.appointment a on a.id = m.appointment_id
      left join public.staff st on st.id = a.user_id
      where cu.business_id = bid
        and m.created_at >= p_from
        and m.created_at <= p_to
        and (
          p_species is null
          or trim(p_species) = ''
          or trim(p_species) = 'Todos'
          or coalesce(pet.species, '') ilike '%' || trim(p_species) || '%'
        )
        and (p_breed is null or trim(p_breed) = '' or pet.breed ilike '%' || p_breed || '%')
      order by m.created_at desc
      limit least(greatest(p_limit, 1), 10000)
      offset greatest(p_offset, 0)
    )
    select coalesce(
      json_agg(
        json_build_object(
          'mascota', b.mascota,
          'especie', coalesce(b.especie, '—'),
          'raza', coalesce(b.raza, '—'),
          'edad_aprox',
            case
              when b.birth_date is null then '—'
              else (
                extract(year from age(current_date, b.birth_date))::int || 'a'
              )
            end,
          'peso_kg', b.peso_kg,
          'diagnostico', coalesce(b.diagnosis, '—'),
          'tratamiento', coalesce(b.treatment, '—'),
          'veterinario', coalesce(b.vet_name, '—'),
          'fecha_consulta', to_char((b.consulta_at at time zone p_tz)::timestamp, 'YYYY-MM-DD HH24:MI'),
          'proxima_visita',
            case
              when b.next_visit_date is null then '—'
              else to_char(b.next_visit_date, 'YYYY-MM-DD')
            end
        )
        order by b.consulta_at desc
      ),
      '[]'::json
    )
    from base b
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) Ocupación por semana ISO (slots teóricos desde schedule vs citas no canceladas)
-- Ingreso potencial no realizado = slots_vacios * precio_promedio_pago (staff en rango)
-- -----------------------------------------------------------------------------
create or replace function public.report_agenda_occupancy(
  p_from timestamptz,
  p_to timestamptz,
  p_staff_id uuid default null,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with staff_list as (
      select s.id, s.name
      from public.staff s
      where s.business_id = bid
        and s.active is true
        and (p_staff_id is null or s.id = p_staff_id)
    ),
    -- calendar days in range (local date)
    days as (
      select d::date as d
      from generate_series(
        (p_from at time zone p_tz)::date,
        (p_to at time zone p_tz)::date,
        interval '1 day'
      ) as g(d)
    ),
    slot_calc as (
      select
        sl.id as staff_id,
        sl.name as staff_name,
        date_trunc('week', d.d::timestamp)::date as week_start,
        d.d,
        extract(dow from d.d)::int as dow_pg,
        sch.id as sch_id,
        sch.service_id,
        sch.start_time,
        sch.end_time,
        greatest(
          1,
          coalesce(
            (select sv.duration_minutes from public.service sv where sv.id = sch.service_id),
            30
          )
        )::numeric as slot_minutes,
        extract(epoch from (sch.end_time - sch.start_time)) / 60.0 as win_minutes
      from staff_list sl
      cross join days d
      join public.schedule sch
        on sch.user_id = sl.id
        and sch.day_of_week = extract(dow from d.d)::int
    ),
    slot_agg as (
      select
        staff_id,
        staff_name,
        week_start,
        sum(
          case
            when win_minutes <= 0 then 0
            else floor(win_minutes / slot_minutes)
          end
        )::bigint as slots_disponibles
      from slot_calc
      group by staff_id, staff_name, week_start
    ),
    ap_week as (
      select
        a.user_id as staff_id,
        date_trunc('week', (a.start_date_time at time zone p_tz)::date::timestamp)::date as week_start,
        count(*) filter (
          where ast.name <> 'Cancelada'
        )::bigint as slots_ocupados
      from public.appointment a
      join public.appointment_status ast on ast.id = a.status_id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
      group by a.user_id, date_trunc('week', (a.start_date_time at time zone p_tz)::date::timestamp)::date
    ),
    avg_price as (
      select
        a.user_id as staff_id,
        case
          when count(*) filter (where ast.name = 'Completada') > 0
          then (sum(pay.amount) filter (where ast.name = 'Completada')) / nullif(count(*) filter (where ast.name = 'Completada'), 0)
          else avg(sv.price)
        end::numeric as avg_ticket
      from public.appointment a
      join public.appointment_status ast on ast.id = a.status_id
      join public.service sv on sv.id = a.service_id
      left join public.payment pay on pay.appointment_id = a.id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
      group by a.user_id
    ),
    merged as (
      select
        st.name as staff,
        to_char(coalesce(sa.week_start, aw.week_start), 'IYYY') || '-W' || lpad(to_char(coalesce(sa.week_start, aw.week_start), 'IW'), 2, '0') as semana,
        coalesce(sa.slots_disponibles, 0::bigint) as slots_disponibles,
        coalesce(aw.slots_ocupados, 0::bigint) as slots_ocupados,
        greatest(
          coalesce(sa.slots_disponibles, 0::bigint) - coalesce(aw.slots_ocupados, 0::bigint),
          0::bigint
        ) as slots_vacios,
        coalesce(ap.avg_ticket, 0::numeric) as avg_ticket
      from slot_agg sa
      full outer join ap_week aw
        on aw.staff_id = sa.staff_id
        and aw.week_start = sa.week_start
      join public.staff st
        on st.id = coalesce(sa.staff_id, aw.staff_id)
        and st.business_id = bid
      left join avg_price ap on ap.staff_id = coalesce(sa.staff_id, aw.staff_id)
    )
    select coalesce(
      json_agg(
        json_build_object(
          'staff', m.staff,
          'semana', m.semana,
          'slots_disponibles', m.slots_disponibles,
          'slots_ocupados', m.slots_ocupados,
          'slots_vacios', m.slots_vacios,
          'tasa_ocupacion_pct',
            case when m.slots_disponibles > 0
              then round((100.0 * m.slots_ocupados::numeric / m.slots_disponibles::numeric), 1)
              else 0::numeric
            end,
          'ingresos_potenciales_no_realizados', round(m.slots_vacios::numeric * m.avg_ticket, 0)
        )
        order by m.staff, m.semana
      ),
      '[]'::json
    )
    from merged m
    where m.slots_disponibles > 0 or m.slots_ocupados > 0
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Próximas visitas recomendadas
-- -----------------------------------------------------------------------------
create or replace function public.report_upcoming_visits(
  p_desde_dias int default 0,
  p_hasta_dias int default 30,
  p_servicio text default null,
  p_tz text default 'America/Bogota',
  p_limit int default 500,
  p_offset int default 0
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  d0 date;
  d1 date;
begin
  if bid is null then
    return '[]'::json;
  end if;

  d0 := current_date + coalesce(p_desde_dias, 0);
  d1 := current_date + coalesce(p_hasta_dias, 30);

  return (
    with base as (
      select
        m.id,
        pet.name as mascota,
        pet.species as especie,
        cu.name as cliente,
        cu.phone as telefono,
        m.next_visit_date,
        m.created_at as consulta_at,
        m.appointment_id,
        st.name as vet_name,
        sv.name as servicio_name
      from public.medical_record m
      join public.pet pet on pet.id = m.pet_id
      join public.customer cu on cu.id = pet.customer_id
      left join public.appointment a on a.id = m.appointment_id
      left join public.staff st on st.id = a.user_id
      left join public.service sv on sv.id = a.service_id
      where cu.business_id = bid
        and m.next_visit_date is not null
        and m.next_visit_date <= d1
        and (
          (m.next_visit_date >= d0 and m.next_visit_date <= d1)
          or (m.next_visit_date < current_date and m.next_visit_date >= current_date - 90)
        )
        and (
          p_servicio is null
          or trim(p_servicio) = ''
          or sv.name ilike '%' || trim(p_servicio) || '%'
        )
      order by m.next_visit_date asc, pet.name
      limit least(greatest(p_limit, 1), 10000)
      offset greatest(p_offset, 0)
    ),
    with_rem as (
      select
        b.*,
        coalesce(
          (select r.sent from public.reminder r where r.appointment_id = b.appointment_id order by r.sent desc nulls last limit 1),
          false
        ) as rem_sent
      from base b
    )
    select coalesce(
      json_agg(
        json_build_object(
          'mascota', w.mascota,
          'especie', coalesce(w.especie, '—'),
          'cliente', w.cliente,
          'telefono', coalesce(w.telefono, '—'),
          'ultima_visita', to_char((w.consulta_at at time zone p_tz)::date, 'YYYY-MM-DD'),
          'proxima_visita_recomendada', to_char(w.next_visit_date, 'YYYY-MM-DD'),
          'dias_restantes',
            case
              when w.next_visit_date < current_date then 'Vencido'
              else (w.next_visit_date - current_date)::text
            end,
          'veterinario', coalesce(w.vet_name, '—'),
          'recordatorio_enviado', case when w.rem_sent then 'Sí' else 'No' end
        )
        order by w.next_visit_date, w.mascota
      ),
      '[]'::json
    )
    from with_rem w
  );
end;
$$;

-- Export all rows for reports that paginate: high limit variant via overload or same params — UI passes p_limit 50000 for export.

grant execute on function public.report_revenue_by_service(timestamptz, timestamptz, text, text, text) to authenticated;
grant execute on function public.report_staff_productivity(timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.report_customer_retention(timestamptz, timestamptz, int, text, int, text) to authenticated;
grant execute on function public.report_cancellations(timestamptz, timestamptz, text, text, int, int) to authenticated;
grant execute on function public.report_medical_history(timestamptz, timestamptz, text, text, text, int, int) to authenticated;
grant execute on function public.report_agenda_occupancy(timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.report_upcoming_visits(int, int, text, text, int, int) to authenticated;

create index if not exists idx_medical_record_next_visit
  on public.medical_record (next_visit_date)
  where next_visit_date is not null;


-- #############################################################################
-- FILE: 20260408100000_email_notifications.sql
-- #############################################################################

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


-- #############################################################################
-- FILE: 20260411120000_payment_transfer_fields_report_revenue.sql
-- #############################################################################

-- Transfer metadata on payments + report column for proof codes + Spanish payment labels in revenue report.

alter table public.payment
  add column if not exists transfer_channel text,
  add column if not exists transfer_proof_code text;

comment on column public.payment.transfer_channel is 'Medio de transferencia (Nequi, DaviPlata, banco, etc.)';
comment on column public.payment.transfer_proof_code is 'Código o referencia del comprobante de transferencia';

create or replace function public.report_revenue_by_service(
  p_from timestamptz,
  p_to timestamptz,
  p_grain text,
  p_payment_method text default null,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  v_grain text := lower(trim(p_grain));
  completed_id smallint;
begin
  if bid is null then
    return '[]'::json;
  end if;
  if v_grain not in ('day', 'week', 'month') then
    v_grain := 'month';
  end if;
  select id into completed_id from public.appointment_status where name = 'Completada' limit 1;

  return (
    with ap as (
      select
        a.id,
        a.service_id,
        s.name as service_name,
        date_trunc(v_grain, (a.start_date_time at time zone p_tz)::timestamp) as period_ts,
        coalesce(pay.amount, 0)::numeric as pay_amt,
        pay.payment_method::text as pay_method,
        pay.id as pay_id,
        pay.transfer_proof_code::text as pay_proof
      from public.appointment a
      join public.service s on s.id = a.service_id
      left join public.payment pay on pay.appointment_id = a.id
        and (
          p_payment_method is null
          or trim(p_payment_method) = ''
          or pay.payment_method::text = trim(p_payment_method)
        )
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and a.status_id = completed_id
        and (
          p_payment_method is null
          or trim(p_payment_method) = ''
          or exists (
            select 1
            from public.payment px
            where px.appointment_id = a.id
              and px.payment_method::text = trim(p_payment_method)
          )
        )
    ),
    agg as (
      select
        period_ts,
        service_name,
        count(distinct id)::int as total_citas_completadas,
        coalesce(sum(pay_amt), 0)::numeric as ingresos_brutos
      from ap
      group by period_ts, service_name
    ),
    with_pct as (
      select
        a.*,
        case when a.total_citas_completadas > 0
          then a.ingresos_brutos / a.total_citas_completadas
          else 0::numeric
        end as ingreso_promedio_por_cita,
        sum(a.ingresos_brutos) over () as grand_total
      from agg a
    ),
    dominant as (
      select distinct on (sub.period_ts, sub.service_name)
        sub.period_ts,
        sub.service_name,
        sub.pay_method as metodo_pago_principal
      from (
        select
          ap.period_ts,
          ap.service_name,
          ap.pay_method,
          sum(ap.pay_amt) as sm
        from ap
        where ap.pay_id is not null
        group by ap.period_ts, ap.service_name, ap.pay_method
      ) sub
      order by sub.period_ts, sub.service_name, sub.sm desc, sub.pay_method
    ),
    transfer_codes as (
      select
        ap.period_ts,
        ap.service_name,
        string_agg(distinct nullif(trim(ap.pay_proof), ''), ', ') as codigos
      from ap
      where ap.pay_id is not null
        and ap.pay_method = 'Transfer'
        and ap.pay_proof is not null
        and length(trim(ap.pay_proof)) > 0
      group by ap.period_ts, ap.service_name
    ),
    labels as (
      select
        w.*,
        case v_grain
          when 'day' then to_char((w.period_ts at time zone p_tz)::date, 'YYYY-MM-DD')
          when 'month' then to_char((w.period_ts at time zone p_tz)::date, 'YYYY-MM')
          else to_char((w.period_ts at time zone p_tz)::date, 'IYYY-"W"IW')
        end as periodo,
        case when w.grand_total > 0
          then round((100.0 * w.ingresos_brutos / w.grand_total)::numeric, 1)
          else 0::numeric
        end as pct_del_total
      from with_pct w
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_ts, ord_svc)
        from (
          select
            l.period_ts as ord_ts,
            l.service_name as ord_svc,
            json_build_object(
              'periodo', l.periodo,
              'servicio', l.service_name,
              'total_citas_completadas', l.total_citas_completadas,
              'ingresos_brutos', l.ingresos_brutos,
              'ingreso_promedio_por_cita', l.ingreso_promedio_por_cita,
              'metodo_pago_principal',
                case coalesce(d.metodo_pago_principal, '—')
                  when 'Cash' then 'Efectivo'
                  when 'Card' then 'Tarjeta'
                  when 'Transfer' then 'Transferencia'
                  else coalesce(d.metodo_pago_principal, '—')
                end,
              'codigo_comprobante_transferencia',
                case
                  when d.metodo_pago_principal = 'Transfer' then coalesce(tc.codigos, '—')
                  else '—'
                end,
              'pct_del_total', l.pct_del_total
            ) as row_json
          from labels l
          left join dominant d on d.period_ts = l.period_ts and d.service_name = l.service_name
          left join transfer_codes tc
            on tc.period_ts = l.period_ts
            and tc.service_name = l.service_name
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;


-- #############################################################################
-- FILE: 20260411180000_client_portal.sql
-- #############################################################################

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


-- #############################################################################
-- FILE: 20260413170000_fix_ensure_token_gen_random_bytes.sql
-- #############################################################################

-- gen_random_bytes comes from pgcrypto. On Supabase it often lives in schema "extensions",
-- while ensure_appointment_public_token used search_path = public only → 42883 at runtime.

create extension if not exists "pgcrypto";

create or replace function public.ensure_appointment_public_token(
  p_appointment_id uuid,
  p_purpose public.appointment_token_purpose,
  p_ttl_hours int default 168
)
returns text
language plpgsql
security definer
set search_path = public, extensions
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


-- #############################################################################
-- FILE: 20260413180000_confirm_token_return_business_id.sql
-- #############################################################################

-- Incluye business_id en la respuesta para enlazar al portal del cliente desde /confirm
-- (sin depender solo del query param del correo).

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
  bid uuid;
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

  select a.business_id into bid
  from public.appointment a
  where a.id = tok.appointment_id
  limit 1;

  if tok.purpose <> 'confirm' then
    return json_build_object('ok', false, 'error', 'WRONG_PURPOSE', 'business_id', bid);
  end if;

  if tok.used_at is not null then
    return json_build_object('ok', false, 'error', 'ALREADY_USED', 'business_id', bid);
  end if;

  if tok.expires_at < now() then
    return json_build_object('ok', false, 'error', 'EXPIRED', 'business_id', bid);
  end if;

  agendada := public._appointment_status_id('Agendada');
  confirmada := public._appointment_status_id('Confirmada');

  select status_id into st from public.appointment where id = tok.appointment_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'NOT_FOUND', 'business_id', bid);
  end if;

  if st <> agendada then
    return json_build_object('ok', false, 'error', 'NOT_PENDING', 'business_id', bid);
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

  return json_build_object('ok', true, 'appointment_id', tok.appointment_id, 'business_id', bid);
end;
$$;

grant execute on function public.confirm_appointment_by_token(text) to anon, authenticated;


-- #############################################################################
-- FILE: 20260413200000_reports_adjustments.sql
-- #############################################################################

-- Reportes: productividad solo veterinarios con citas en el rango; retención sin segmento;
-- historial clínico: filtro de especie por coincidencia exacta (valores del catálogo).

-- 1) Productividad: solo rol Veterinario; excluir filas sin citas agendadas en el período.
create or replace function public.report_staff_productivity(
  p_from timestamptz,
  p_to timestamptz,
  p_role text default null,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with st as (
      select s.id, s.name, r.name as role_name
      from public.staff s
      join public.role r on r.id = s.role_id
      where s.business_id = bid
        and s.active is true
        and r.name = 'Veterinario'
    ),
    ap as (
      select
        a.user_id,
        ast.name as st_name,
        a.id as ap_id,
        extract(epoch from (a.end_date_time - a.start_date_time)) / 60.0 as dur_min
      from public.appointment a
      join public.appointment_status ast on ast.id = a.status_id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
    ),
    pay_tot as (
      select a.user_id, sum(p.amount)::numeric as amt
      from public.appointment a
      join public.payment p on p.appointment_id = a.id
      join public.appointment_status ast on ast.id = a.status_id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and ast.name = 'Completada'
      group by a.user_id
    ),
    stats as (
      select
        st.id as staff_id,
        st.name as staff_nombre,
        st.role_name as rol,
        count(ap.ap_id)::int as citas_agendadas,
        count(*) filter (where ap.st_name = 'Completada')::int as citas_completadas,
        count(*) filter (where ap.st_name = 'Cancelada')::int as canceladas,
        count(*) filter (where ap.st_name = 'NoShow')::int as no_show,
        coalesce(max(pt.amt), 0::numeric) as ingresos_generados,
        avg(ap.dur_min) filter (where ap.st_name = 'Completada') as dur_avg
      from st
      left join ap on ap.user_id = st.id
      left join pay_tot pt on pt.user_id = st.id
      group by st.id, st.name, st.role_name
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_name)
        from (
          select
            s.staff_nombre as ord_name,
            json_build_object(
              'staff_nombre', s.staff_nombre,
              'rol', s.rol,
              'citas_agendadas', coalesce(s.citas_agendadas, 0),
              'citas_completadas', coalesce(s.citas_completadas, 0),
              'canceladas', coalesce(s.canceladas, 0),
              'no_show', coalesce(s.no_show, 0),
              'tasa_completitud',
                case when coalesce(s.citas_agendadas, 0) > 0
                  then round((100.0 * s.citas_completadas / s.citas_agendadas)::numeric, 1)
                  else 0::numeric
                end,
              'ingresos_generados', coalesce(s.ingresos_generados, 0),
              'duracion_promedio_min',
                case
                  when s.dur_avg is null then null
                  else round(s.dur_avg::numeric, 1)
                end
            ) as row_json
          from stats s
          where coalesce(s.citas_agendadas, 0) > 0
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;

-- 2) Retención: quitar segmento y parámetro p_segment.
drop function if exists public.report_customer_retention(timestamptz, timestamptz, int, text, int, text);

create or replace function public.report_customer_retention(
  p_from timestamptz,
  p_to timestamptz,
  p_min_citas int default 1,
  p_inactive_days int default 120,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with cust as (
      select c.id, c.name, c.phone, c.email
      from public.customer c
      where c.business_id = bid
    ),
    pets as (
      select p.customer_id, count(*)::int as n
      from public.pet p
      join cust on cust.id = p.customer_id
      group by p.customer_id
    ),
    ap_stats as (
      select
        a.customer_id,
        count(*)::int as total_citas,
        max(a.start_date_time) as ultima_cita,
        min(a.start_date_time) as primera_cita
      from public.appointment a
      where a.business_id = bid
      group by a.customer_id
    ),
    paid as (
      select
        a.customer_id,
        coalesce(sum(pay.amount), 0)::numeric as total_pagado
      from public.appointment a
      join public.payment pay on pay.appointment_id = a.id
      where a.business_id = bid
      group by a.customer_id
    ),
    base as (
      select
        c.id,
        c.name as cliente_nombre,
        c.phone as telefono,
        c.email as email,
        coalesce(pt.n, 0)::int as total_mascotas,
        coalesce(st.total_citas, 0)::int as total_citas,
        st.ultima_cita,
        coalesce(pd.total_pagado, 0)::numeric as total_pagado,
        case
          when st.ultima_cita is null then null::int
          else (current_date - (st.ultima_cita at time zone p_tz)::date)::int
        end as dias_sin_visita
      from cust c
      left join pets pt on pt.customer_id = c.id
      left join ap_stats st on st.customer_id = c.id
      left join paid pd on pd.customer_id = c.id
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_name)
        from (
          select
            b.cliente_nombre as ord_name,
            json_build_object(
              'cliente_nombre', b.cliente_nombre,
              'telefono', coalesce(b.telefono, '—'),
              'email', coalesce(b.email, '—'),
              'total_mascotas', b.total_mascotas,
              'total_citas', b.total_citas,
              'ultima_cita',
                case
                  when b.ultima_cita is null then '—'
                  else to_char((b.ultima_cita at time zone p_tz)::date, 'YYYY-MM-DD')
                end,
              'total_pagado', b.total_pagado,
              'dias_sin_visita', coalesce(b.dias_sin_visita, 0)
            ) as row_json
          from base b
          where b.total_citas >= p_min_citas
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;

grant execute on function public.report_customer_retention(timestamptz, timestamptz, int, int, text) to authenticated;

-- 3) Historial clínico: especie filtrada por valor exacto (catálogo / texto enviado desde la app).
create or replace function public.report_medical_history(
  p_from timestamptz,
  p_to timestamptz,
  p_species text default null,
  p_breed text default null,
  p_tz text default 'America/Bogota',
  p_limit int default 500,
  p_offset int default 0
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
begin
  if bid is null then
    return '[]'::json;
  end if;

  return (
    with base as (
      select
        m.id,
        pet.name as mascota,
        pet.species as especie,
        pet.breed as raza,
        pet.birth_date,
        coalesce(m.weight, pet.weight) as peso_kg,
        m.diagnosis,
        m.treatment,
        m.next_visit_date,
        m.created_at as consulta_at,
        st.name as vet_name
      from public.medical_record m
      join public.pet pet on pet.id = m.pet_id
      join public.customer cu on cu.id = pet.customer_id
      left join public.appointment a on a.id = m.appointment_id
      left join public.staff st on st.id = a.user_id
      where cu.business_id = bid
        and m.created_at >= p_from
        and m.created_at <= p_to
        and (
          p_species is null
          or trim(p_species) = ''
          or lower(trim(coalesce(pet.species, ''))) = lower(trim(p_species))
        )
        and (p_breed is null or trim(p_breed) = '' or pet.breed ilike '%' || p_breed || '%')
      order by m.created_at desc
      limit least(greatest(p_limit, 1), 10000)
      offset greatest(p_offset, 0)
    )
    select coalesce(
      json_agg(
        json_build_object(
          'mascota', b.mascota,
          'especie', coalesce(b.especie, '—'),
          'raza', coalesce(b.raza, '—'),
          'edad_aprox',
            case
              when b.birth_date is null then '—'
              else (
                extract(year from age(current_date, b.birth_date))::int || 'a'
              )
            end,
          'peso_kg', b.peso_kg,
          'diagnostico', coalesce(b.diagnosis, '—'),
          'tratamiento', coalesce(b.treatment, '—'),
          'veterinario', coalesce(b.vet_name, '—'),
          'fecha_consulta', to_char((b.consulta_at at time zone p_tz)::timestamp, 'YYYY-MM-DD HH24:MI'),
          'proxima_visita',
            case
              when b.next_visit_date is null then '—'
              else to_char(b.next_visit_date, 'YYYY-MM-DD')
            end
        )
        order by b.consulta_at desc
      ),
      '[]'::json
    )
    from base b
  );
end;
$$;


-- #############################################################################
-- FILE: 20260413210000_customer_portal_account_staff_select.sql
-- #############################################################################

-- Staff del negocio puede ver si un cliente tiene cuenta de portal (solo lectura).

create policy portal_account_staff_select
  on public.customer_portal_account
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.customer cu
      where cu.id = customer_portal_account.customer_id
        and cu.business_id = public.current_business_id()
    )
  );


-- #############################################################################
-- FILE: 20260413220000_customer_portal_account_grant_select.sql
-- #############################################################################

-- Asegurar que el rol de la app pueda evaluar RLS sobre filas de portal (además de la política staff).

grant select on table public.customer_portal_account to authenticated;


-- #############################################################################
-- FILE: 20260413230000_portal_service_staff_select.sql
-- #############################################################################

-- Portal clients: permitir leer servicios y staff de su clínica (p. ej. embeds en appointment desde el portal).
create policy service_portal_select
  on public.service
  for select
  to authenticated
  using (
    public.current_portal_business_id() is not null
    and business_id = public.current_portal_business_id()
  );

create policy staff_portal_select
  on public.staff
  for select
  to authenticated
  using (
    public.current_portal_business_id() is not null
    and business_id = public.current_portal_business_id()
  );


-- #############################################################################
-- FILE: 20260413233000_schedule_two_windows_per_day.sql
-- #############################################################################

-- Permitir dos franjas por día y servicio (p. ej. mañana + tarde con almuerzo).
alter table public.schedule
  add column if not exists window_order smallint not null default 1;

alter table public.schedule
  drop constraint if exists schedule_window_order_chk;

alter table public.schedule
  add constraint schedule_window_order_chk
  check (window_order in (1, 2));

drop index if exists public.idx_schedule_user_day_service_unique;

create unique index if not exists idx_schedule_user_day_service_window_unique
  on public.schedule (user_id, day_of_week, service_id, window_order)
  nulls not distinct;

comment on column public.schedule.window_order is
  '1 = primera franja del día, 2 = segunda (p. ej. después del almuerzo).';


-- #############################################################################
-- FILE: 20260414100000_portal_dashboard_rpcs.sql
-- #############################################################################

-- Portal client dashboard: clinic contact for WhatsApp; safe appointment cancel.

-- -----------------------------------------------------------------------------
-- Clinic name + phone for logged-in portal users (no public_booking_enabled gate).
-- -----------------------------------------------------------------------------
create or replace function public.get_portal_clinic_profile()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid;
begin
  bid := public.current_portal_business_id();
  if bid is null then
    return null;
  end if;

  return (
    select json_build_object(
      'id', b.id,
      'name', b.name,
      'phone', nullif(trim(b.phone), '')
    )
    from public.business b
    where b.id = bid
    limit 1
  );
end;
$$;

revoke all on function public.get_portal_clinic_profile() from public;
grant execute on function public.get_portal_clinic_profile() to authenticated;

-- -----------------------------------------------------------------------------
-- Cancel own future appointment (Agendada | Confirmada -> Cancelada).
-- -----------------------------------------------------------------------------
create or replace function public.portal_cancel_appointment(p_appointment_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  agendada smallint;
  confirmada smallint;
  cancelada smallint;
  cur_cust uuid;
  cur_stat smallint;
  cur_start timestamptz;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'AUTH');
  end if;

  cid := public.current_portal_customer_id();
  if cid is null then
    return json_build_object('ok', false, 'error', 'PORTAL');
  end if;

  select a.customer_id, a.status_id, a.start_date_time
  into cur_cust, cur_stat, cur_start
  from public.appointment a
  where a.id = p_appointment_id
  for update;

  if cur_cust is null then
    return json_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  if cur_cust is distinct from cid then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  agendada := public._appointment_status_id('Agendada');
  confirmada := public._appointment_status_id('Confirmada');
  cancelada := public._appointment_status_id('Cancelada');

  if cancelada is null then
    return json_build_object('ok', false, 'error', 'CONFIG');
  end if;

  if cur_stat is distinct from agendada and cur_stat is distinct from confirmada then
    return json_build_object('ok', false, 'error', 'STATUS');
  end if;

  if cur_start <= now() then
    return json_build_object('ok', false, 'error', 'PAST');
  end if;

  update public.appointment
  set status_id = cancelada
  where id = p_appointment_id;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.portal_cancel_appointment(uuid) from public;
grant execute on function public.portal_cancel_appointment(uuid) to authenticated;


-- #############################################################################
-- FILE: 20260415100000_pet_portal_update.sql
-- #############################################################################

-- Portal clients: permitir actualizar datos de sus propias mascotas (sin cambiar de tutor).

create policy pet_portal_update
  on public.pet
  for update
  to authenticated
  using (customer_id = public.current_portal_customer_id())
  with check (customer_id = public.current_portal_customer_id());


-- #############################################################################
-- FILE: 20260415183000_portal_invoice_read.sql
-- #############################################################################

-- Portal clientes: lectura de pagos y gastos adicionales de SUS citas (factura en portal).

create policy payment_portal_select
  on public.payment
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.appointment a
      where a.id = payment.appointment_id
        and a.customer_id = public.current_portal_customer_id()
    )
  );

create policy appointment_extra_charge_portal_select
  on public.appointment_extra_charge
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.appointment a
      where a.id = appointment_extra_charge.appointment_id
        and a.customer_id = public.current_portal_customer_id()
    )
  );



-- #############################################################################
-- FILE: 20260416120000_appointment_attention_and_extra_charges.sql
-- #############################################################################

-- Atención en curso (cronómetro) + líneas de gastos adicionales por cita.

alter table public.appointment
  add column if not exists attention_started_at timestamptz;

comment on column public.appointment.attention_started_at is
  'Momento en que se inició la atención en consultorio; null si aún no.';

create table public.appointment_extra_charge (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointment (id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index idx_appointment_extra_charge_appt on public.appointment_extra_charge (appointment_id);

alter table public.appointment_extra_charge enable row level security;

create policy appointment_extra_charge_all on public.appointment_extra_charge for all to authenticated
  using (
    exists (
      select 1 from public.appointment a
      where a.id = appointment_extra_charge.appointment_id
        and a.business_id = public.current_business_id()
    )
  )
  with check (
    exists (
      select 1 from public.appointment a
      where a.id = appointment_extra_charge.appointment_id
        and a.business_id = public.current_business_id()
    )
  );

-- Ingresos por servicio: suma de gastos adicionales por bucket (sin duplicar por join de pagos).
create or replace function public.report_revenue_by_service(
  p_from timestamptz,
  p_to timestamptz,
  p_grain text,
  p_payment_method text default null,
  p_tz text default 'America/Bogota'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  v_grain text := lower(trim(p_grain));
  completed_id smallint;
begin
  if bid is null then
    return '[]'::json;
  end if;
  if v_grain not in ('day', 'week', 'month') then
    v_grain := 'month';
  end if;
  select id into completed_id from public.appointment_status where name = 'Completada' limit 1;

  return (
    with ap as (
      select
        a.id,
        a.service_id,
        s.name as service_name,
        date_trunc(v_grain, (a.start_date_time at time zone p_tz)::timestamp) as period_ts,
        coalesce(pay.amount, 0)::numeric as pay_amt,
        pay.payment_method::text as pay_method,
        pay.id as pay_id,
        pay.transfer_proof_code::text as pay_proof
      from public.appointment a
      join public.service s on s.id = a.service_id
      left join public.payment pay on pay.appointment_id = a.id
        and (
          p_payment_method is null
          or trim(p_payment_method) = ''
          or pay.payment_method::text = trim(p_payment_method)
        )
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and a.status_id = completed_id
        and (
          p_payment_method is null
          or trim(p_payment_method) = ''
          or exists (
            select 1
            from public.payment px
            where px.appointment_id = a.id
              and px.payment_method::text = trim(p_payment_method)
          )
        )
    ),
    extras_bucket as (
      select
        date_trunc(v_grain, (a.start_date_time at time zone p_tz)::timestamp) as period_ts,
        s.name as service_name,
        coalesce(sum(ec.amount), 0)::numeric as total_extras
      from public.appointment a
      join public.service s on s.id = a.service_id
      join public.appointment_extra_charge ec on ec.appointment_id = a.id
      where a.business_id = bid
        and a.start_date_time >= p_from
        and a.start_date_time <= p_to
        and a.status_id = completed_id
      group by 1, 2
    ),
    agg as (
      select
        period_ts,
        service_name,
        count(distinct id)::int as total_citas_completadas,
        coalesce(sum(pay_amt), 0)::numeric as ingresos_brutos
      from ap
      group by period_ts, service_name
    ),
    with_pct as (
      select
        a.*,
        case when a.total_citas_completadas > 0
          then a.ingresos_brutos / a.total_citas_completadas
          else 0::numeric
        end as ingreso_promedio_por_cita,
        sum(a.ingresos_brutos) over () as grand_total
      from agg a
    ),
    dominant as (
      select distinct on (sub.period_ts, sub.service_name)
        sub.period_ts,
        sub.service_name,
        sub.pay_method as metodo_pago_principal
      from (
        select
          ap.period_ts,
          ap.service_name,
          ap.pay_method,
          sum(ap.pay_amt) as sm
        from ap
        where ap.pay_id is not null
        group by ap.period_ts, ap.service_name, ap.pay_method
      ) sub
      order by sub.period_ts, sub.service_name, sub.sm desc, sub.pay_method
    ),
    transfer_codes as (
      select
        ap.period_ts,
        ap.service_name,
        string_agg(distinct nullif(trim(ap.pay_proof), ''), ', ') as codigos
      from ap
      where ap.pay_id is not null
        and ap.pay_method = 'Transfer'
        and ap.pay_proof is not null
        and length(trim(ap.pay_proof)) > 0
      group by ap.period_ts, ap.service_name
    ),
    labels as (
      select
        w.*,
        case v_grain
          when 'day' then to_char((w.period_ts at time zone p_tz)::date, 'YYYY-MM-DD')
          when 'month' then to_char((w.period_ts at time zone p_tz)::date, 'YYYY-MM')
          else to_char((w.period_ts at time zone p_tz)::date, 'IYYY-"W"IW')
        end as periodo,
        case when w.grand_total > 0
          then round((100.0 * w.ingresos_brutos / w.grand_total)::numeric, 1)
          else 0::numeric
        end as pct_del_total
      from with_pct w
    )
    select coalesce(
      (
        select json_agg(row_json order by ord_ts, ord_svc)
        from (
          select
            l.period_ts as ord_ts,
            l.service_name as ord_svc,
            json_build_object(
              'periodo', l.periodo,
              'servicio', l.service_name,
              'total_citas_completadas', l.total_citas_completadas,
              'ingresos_brutos', l.ingresos_brutos,
              'gastos_adicionales', coalesce(xb.total_extras, 0::numeric),
              'ingreso_promedio_por_cita', l.ingreso_promedio_por_cita,
              'metodo_pago_principal',
                case coalesce(d.metodo_pago_principal, '—')
                  when 'Cash' then 'Efectivo'
                  when 'Card' then 'Tarjeta'
                  when 'Transfer' then 'Transferencia'
                  else coalesce(d.metodo_pago_principal, '—')
                end,
              'codigo_comprobante_transferencia',
                case
                  when d.metodo_pago_principal = 'Transfer' then coalesce(tc.codigos, '—')
                  else '—'
                end,
              'pct_del_total', l.pct_del_total
            ) as row_json
          from labels l
          left join dominant d on d.period_ts = l.period_ts and d.service_name = l.service_name
          left join transfer_codes tc
            on tc.period_ts = l.period_ts
            and tc.service_name = l.service_name
          left join extras_bucket xb
            on xb.period_ts = l.period_ts
            and xb.service_name = l.service_name
        ) q
      ),
      '[]'::json
    )
  );
end;
$$;


-- #############################################################################
-- FILE: 20260416130000_auto_noshow_on_appointment_end.sql
-- #############################################################################

-- Auto NoShow: marca citas vencidas (sin atención) como NoShow.
-- Reglas:
--  - end_date_time <= now()
--  - estado actual en Agendada o Confirmada
--  - attention_started_at is null

create or replace function public.mark_overdue_appointments_as_noshow(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  agendada_id smallint;
  confirmada_id smallint;
  noshow_id smallint;
  v_updated int := 0;
begin
  agendada_id := public._appointment_status_id('Agendada');
  confirmada_id := public._appointment_status_id('Confirmada');
  noshow_id := public._appointment_status_id('NoShow');

  if agendada_id is null or confirmada_id is null or noshow_id is null then
    return 0;
  end if;

  with changed as (
    update public.appointment a
    set status_id = noshow_id
    where a.end_date_time <= p_now
      and a.status_id in (agendada_id, confirmada_id)
      and a.attention_started_at is null
    returning 1
  )
  select count(*)::int into v_updated
  from changed;

  return coalesce(v_updated, 0);
end;
$$;

comment on function public.mark_overdue_appointments_as_noshow(timestamptz) is
  'Marca en NoShow citas vencidas en Agendada/Confirmada sin atencion iniciada.';

revoke all on function public.mark_overdue_appointments_as_noshow(timestamptz) from public;
grant execute on function public.mark_overdue_appointments_as_noshow(timestamptz) to service_role;

-- Scheduler DB-side (pg_cron): ejecuta cada minuto para transición casi en tiempo real.
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select j.jobid
    into existing_job_id
  from cron.job j
  where j.jobname = 'auto_noshow_appointments'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'auto_noshow_appointments',
    '* * * * *',
    'select public.mark_overdue_appointments_as_noshow();'
  );
exception
  when undefined_table then
    raise exception 'pg_cron no esta disponible en este entorno';
end;
$$;
