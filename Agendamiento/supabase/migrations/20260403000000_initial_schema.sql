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
