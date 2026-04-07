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
