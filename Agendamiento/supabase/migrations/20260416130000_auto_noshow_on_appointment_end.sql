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
