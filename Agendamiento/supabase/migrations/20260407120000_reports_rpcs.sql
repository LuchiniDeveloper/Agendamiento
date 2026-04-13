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
