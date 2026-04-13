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
