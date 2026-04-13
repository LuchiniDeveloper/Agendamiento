-- Incluye business_id en la respuesta para enlazar al portal del cliente desde /confirm
-- (sin depender solo del query param del correo).

create or replace function public.confirm_appointment_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.appointment_public_token%rowtype;
  agendada smallint;
  confirmada smallint;
  st smallint;
  bid uuid;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  select * into tok
  from public.appointment_public_token
  where token = trim(p_token)
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  select a.business_id into bid
  from public.appointment a
  where a.id = tok.appointment_id
  limit 1;

  if tok.purpose <> 'confirm' then
    return json_build_object('ok', false, 'error', 'WRONG_PURPOSE', 'business_id', bid);
  end if;

  if tok.used_at is not null then
    return json_build_object('ok', false, 'error', 'ALREADY_USED', 'business_id', bid);
  end if;

  if tok.expires_at < now() then
    return json_build_object('ok', false, 'error', 'EXPIRED', 'business_id', bid);
  end if;

  agendada := public._appointment_status_id('Agendada');
  confirmada := public._appointment_status_id('Confirmada');

  select status_id into st from public.appointment where id = tok.appointment_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'NOT_FOUND', 'business_id', bid);
  end if;

  if st <> agendada then
    return json_build_object('ok', false, 'error', 'NOT_PENDING', 'business_id', bid);
  end if;

  update public.appointment
  set status_id = confirmada
  where id = tok.appointment_id;

  update public.appointment_public_token
  set used_at = now()
  where id = tok.id;

  update public.appointment_notification
  set status = 'skipped',
      last_error = 'Cita confirmada por el cliente',
      updated_at = now()
  where appointment_id = tok.appointment_id
    and kind = 'CONFIRM_REMINDER'
    and status in ('pending', 'scheduled', 'sending');

  return json_build_object('ok', true, 'appointment_id', tok.appointment_id, 'business_id', bid);
end;
$$;

grant execute on function public.confirm_appointment_by_token(text) to anon, authenticated;
