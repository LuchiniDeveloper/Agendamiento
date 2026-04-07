-- =============================================================================
-- Agendamiento — esquema público consolidado (baseline)
-- =============================================================================
-- Generado a partir de todas las migraciones en supabase/migrations/, en orden
-- cronológico. Equivale a aplicar esas migraciones sobre una base vacía que
-- ya tenga el esquema auth de Supabase (auth.users, etc.).
--
-- USO PREVISTO
--   • Recuperación manual / documentación / referencia en un solo archivo.
--   • Nuevo proyecto Supabase: SQL Editor (postgres) o psql, NO sobre una BD
--     que ya tenga estas tablas (fallaría en CREATE TABLE duplicado).
--
-- NO INCLUYE
--   • Edge Functions, Storage, Auth (usuarios), ni datos de negocio.
--   • Cambios aplicados solo en remoto y no versionados en migrations/.
--
-- Mantén la fuente de verdad en supabase/migrations/; actualiza este archivo si
-- añades migraciones nuevas (o regenera concatenando de nuevo).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260403000000_initial_schema.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260403120000_service_description_max_250.sql
-- -----------------------------------------------------------------------------

-- Límite de descripción de servicio (alineado con el formulario)
alter table public.service
  add constraint service_description_max_250
  check (description is null or char_length(description) <= 250);


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260403130000_staff_email_bootstrap.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260404120000_onboarding_list_join_clinic.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260406120000_clients_services_agenda_rules.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260406190000_fix_get_available_slots_calendar_date.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260406200000_get_available_slots_robust.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260406210000_get_available_slots_service_priority.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260406230000_get_available_slots_exclude_appointment.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- SOURCE: migrations/20260406240000_get_available_slots_skip_past_today.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- POST-MIGRATIONS: permiso RPC firma final get_available_slots (6 argumentos)
-- Las migraciones 062300+ no repiten GRANT; sin esto, authenticated no puede
-- ejecutar la versión con p_exclude_appointment_id tras un restore limpio.
-- -----------------------------------------------------------------------------
grant execute on function public.get_available_slots(uuid, uuid, date, text, smallint, uuid) to authenticated;

