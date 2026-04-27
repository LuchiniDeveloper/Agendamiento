-- Preview + claim earlier released slot using public reschedule token (anon-friendly).

create or replace function public.preview_earlier_slot_reschedule(p_token text, p_released_slot_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tok public.appointment_public_token%rowtype;
  ap public.appointment%rowtype;
  rs public.released_slot%rowtype;
  pet_name text;
  svc_name text;
  vet_name text;
  dur interval;
  new_end timestamptz;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  if p_released_slot_id is null then
    return json_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into tok
  from public.appointment_public_token
  where token = trim(p_token)
    and purpose = 'reschedule'
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  if tok.used_at is not null then
    return json_build_object('ok', false, 'error', 'ALREADY_USED');
  end if;

  if tok.expires_at < now() then
    return json_build_object('ok', false, 'error', 'EXPIRED');
  end if;

  select * into ap from public.appointment where id = tok.appointment_id limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select * into rs from public.released_slot where id = p_released_slot_id limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  if rs.status <> 'open' then
    return json_build_object('ok', false, 'error', 'SLOT_ALREADY_TAKEN');
  end if;

  if rs.start_at <= now() then
    return json_build_object('ok', false, 'error', 'SLOT_EXPIRED');
  end if;

  if ap.business_id <> rs.business_id
     or ap.user_id <> rs.staff_id
     or ap.service_id <> rs.service_id then
    return json_build_object('ok', false, 'error', 'SLOT_NOT_COMPATIBLE');
  end if;

  if rs.start_at >= ap.start_date_time then
    return json_build_object('ok', false, 'error', 'NOT_EARLIER');
  end if;

  dur := ap.end_date_time - ap.start_date_time;
  if dur > (rs.end_at - rs.start_at) then
    return json_build_object('ok', false, 'error', 'INSUFFICIENT_DURATION');
  end if;

  select p.name into pet_name from public.pet p where p.id = ap.pet_id;
  select s.name into svc_name from public.service s where s.id = ap.service_id;
  select st.name into vet_name from public.staff st where st.id = ap.user_id;
  new_end := rs.start_at + dur;

  return json_build_object(
    'ok', true,
    'appointment_id', ap.id,
    'business_id', ap.business_id,
    'current_start', ap.start_date_time,
    'current_end', ap.end_date_time,
    'new_start', rs.start_at,
    'new_end', new_end,
    'pet_name', coalesce(pet_name, ''),
    'service_name', coalesce(svc_name, ''),
    'vet_name', coalesce(vet_name, '')
  );
end;
$$;

grant execute on function public.preview_earlier_slot_reschedule(text, uuid) to anon, authenticated;

create or replace function public.claim_released_slot_with_reschedule_token(p_token text, p_released_slot_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.appointment_public_token%rowtype;
  v_slot public.released_slot%rowtype;
  v_appt public.appointment%rowtype;
  v_cancelled_id smallint;
  v_completed_id smallint;
  v_noshow_id smallint;
  dur interval;
  pet_name text;
  svc_name text;
  vet_name text;
  new_start timestamptz;
  new_end timestamptz;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  if p_released_slot_id is null then
    return json_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into tok
  from public.appointment_public_token
  where token = trim(p_token)
    and purpose = 'reschedule'
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  if tok.used_at is not null then
    return json_build_object('ok', false, 'error', 'ALREADY_USED');
  end if;

  if tok.expires_at < now() then
    return json_build_object('ok', false, 'error', 'EXPIRED');
  end if;

  select * into v_slot
  from public.released_slot
  where id = p_released_slot_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  if v_slot.status <> 'open' then
    return json_build_object('ok', false, 'error', 'SLOT_ALREADY_TAKEN');
  end if;

  if v_slot.start_at <= now() then
    update public.released_slot set status = 'expired' where id = v_slot.id;
    return json_build_object('ok', false, 'error', 'SLOT_EXPIRED');
  end if;

  select * into v_appt
  from public.appointment
  where id = tok.appointment_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'APPOINTMENT_NOT_FOUND');
  end if;

  v_cancelled_id := public._appointment_status_id('Cancelada');
  v_completed_id := public._appointment_status_id('Completada');
  v_noshow_id := public._appointment_status_id('NoShow');
  if v_appt.status_id in (v_cancelled_id, v_completed_id, v_noshow_id) then
    return json_build_object('ok', false, 'error', 'APPOINTMENT_NOT_ELIGIBLE');
  end if;

  if v_appt.business_id <> v_slot.business_id
     or v_appt.user_id <> v_slot.staff_id
     or v_appt.service_id <> v_slot.service_id then
    return json_build_object('ok', false, 'error', 'SLOT_NOT_COMPATIBLE');
  end if;

  if v_slot.start_at >= v_appt.start_date_time then
    return json_build_object('ok', false, 'error', 'NOT_EARLIER');
  end if;

  dur := v_appt.end_date_time - v_appt.start_date_time;
  if dur > (v_slot.end_at - v_slot.start_at) then
    return json_build_object('ok', false, 'error', 'INSUFFICIENT_DURATION');
  end if;

  new_start := v_slot.start_at;
  new_end := v_slot.start_at + dur;

  update public.appointment
  set start_date_time = new_start,
      end_date_time = new_end,
      rescheduled_from_released_slot_id = v_slot.id
  where id = v_appt.id;

  update public.released_slot
  set status = 'claimed',
      claimed_by_appointment_id = v_appt.id
  where id = v_slot.id
    and status = 'open';

  if not found then
    return json_build_object('ok', false, 'error', 'SLOT_ALREADY_TAKEN');
  end if;

  update public.appointment_public_token
  set used_at = now()
  where id = tok.id;

  select p.name into pet_name from public.pet p where p.id = v_appt.pet_id;
  select s.name into svc_name from public.service s where s.id = v_appt.service_id;
  select st.name into vet_name from public.staff st where st.id = v_appt.user_id;

  return json_build_object(
    'ok', true,
    'appointment_id', v_appt.id,
    'new_start', new_start,
    'new_end', new_end,
    'pet_name', coalesce(pet_name, ''),
    'service_name', coalesce(svc_name, ''),
    'vet_name', coalesce(vet_name, '')
  );
end;
$$;

grant execute on function public.claim_released_slot_with_reschedule_token(text, uuid) to anon, authenticated;
