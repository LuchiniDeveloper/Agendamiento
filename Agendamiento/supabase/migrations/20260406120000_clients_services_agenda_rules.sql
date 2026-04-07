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
