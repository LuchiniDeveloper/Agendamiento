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
