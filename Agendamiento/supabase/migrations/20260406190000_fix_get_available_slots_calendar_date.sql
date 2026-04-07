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
