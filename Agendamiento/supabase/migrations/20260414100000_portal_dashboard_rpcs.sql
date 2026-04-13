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
