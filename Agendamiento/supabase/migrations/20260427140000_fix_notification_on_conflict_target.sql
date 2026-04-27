-- Fix 42P10: partial unique indexes are not valid arbiters for
-- ON CONFLICT (appointment_id, kind). Use one expression unique index plus
-- matching ON CONFLICT (...) on all notification inserts.

drop index if exists public.uniq_appt_notif_appt_kind_single;
drop index if exists public.uniq_appt_notif_earlier_slot;

-- Non-partial: third term differentiates multiple EARLIER_SLOT_AVAILABLE per appointment (per released_slot id).
create unique index if not exists uniq_appt_notif_dedupe_key
  on public.appointment_notification (
    appointment_id,
    kind,
    (coalesce(payload_snapshot->>'released_slot_id', ''))
  );

create or replace function public.enqueue_earlier_slot_notifications(p_released_slot_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.released_slot%rowtype;
  v_count int := 0;
  v_cancelled_id smallint;
  v_completed_id smallint;
  v_noshow_id smallint;
  rec record;
  v_smtp_on boolean;
  v_email text;
begin
  if p_released_slot_id is null then
    return 0;
  end if;

  select * into v_slot
  from public.released_slot
  where id = p_released_slot_id
    and status = 'open'
  limit 1;

  if not found then
    return 0;
  end if;

  v_cancelled_id := public._appointment_status_id('Cancelada');
  v_completed_id := public._appointment_status_id('Completada');
  v_noshow_id := public._appointment_status_id('NoShow');

  for rec in
    select
      a.id as appointment_id,
      a.customer_id,
      a.start_date_time
    from public.appointment a
    join public.appointment_earlier_slot_opt_in o on o.appointment_id = a.id
    where a.business_id = v_slot.business_id
      and a.user_id = v_slot.staff_id
      and a.service_id = v_slot.service_id
      and o.enabled = true
      and a.start_date_time > now()
      and a.start_date_time > v_slot.start_at
      and (v_cancelled_id is null or a.status_id <> v_cancelled_id)
      and (v_completed_id is null or a.status_id <> v_completed_id)
      and (v_noshow_id is null or a.status_id <> v_noshow_id)
      and a.id <> v_slot.source_appointment_id
      and (a.end_date_time - a.start_date_time) <= (v_slot.end_at - v_slot.start_at)
  loop
    select nullif(trim(c.email), '') into v_email
    from public.customer c
    where c.id = rec.customer_id;

    select coalesce(s.enabled, false) into v_smtp_on
    from public.business_smtp_settings s
    where s.business_id = v_slot.business_id;

    if v_email is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        v_slot.business_id, rec.appointment_id, 'EARLIER_SLOT_AVAILABLE', 'skipped', null,
        'Sin correo del cliente',
        jsonb_build_object('reason', 'no_email', 'released_slot_id', v_slot.id::text)
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
      continue;
    end if;

    if not v_smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        v_slot.business_id, rec.appointment_id, 'EARLIER_SLOT_AVAILABLE', 'skipped', v_email,
        'SMTP desactivado o sin configurar',
        jsonb_build_object('reason', 'smtp_disabled', 'released_slot_id', v_slot.id::text)
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
      continue;
    end if;

    insert into public.appointment_notification (
      business_id, appointment_id, kind, status, recipient_email, payload_snapshot
    ) values (
      v_slot.business_id,
      rec.appointment_id,
      'EARLIER_SLOT_AVAILABLE',
      'pending',
      v_email,
      jsonb_build_object(
        'released_slot_id', v_slot.id::text,
        'released_slot_start_at', v_slot.start_at,
        'released_slot_end_at', v_slot.end_at
      )
    )
    on conflict (
      appointment_id,
      kind,
      (coalesce(payload_snapshot->>'released_slot_id', ''))
    ) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.tg_appointment_notify_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  agendada smallint;
  confirmada smallint;
  completada smallint;
  cancelada smallint;
  noshow smallint;
  em text;
  smtp_on boolean;
  diag text;
begin
  if new.booking_source = 'public_guest'::public.appointment_booking_source then
    return new;
  end if;

  if new.status_id is not distinct from old.status_id then
    return new;
  end if;

  agendada := public._appointment_status_id('Agendada');
  confirmada := public._appointment_status_id('Confirmada');
  completada := public._appointment_status_id('Completada');
  cancelada := public._appointment_status_id('Cancelada');
  noshow := public._appointment_status_id('NoShow');

  select nullif(trim(c.email), '') into em
  from public.customer c
  where c.id = new.customer_id;

  select coalesce(s.enabled, false) into smtp_on
  from public.business_smtp_settings s
  where s.business_id = new.business_id;

  if old.status_id = agendada and new.status_id = confirmada then
    update public.appointment_notification
    set status = 'skipped',
        last_error = 'Cita confirmada antes del recordatorio',
        updated_at = now()
    where appointment_id = new.id
      and kind = 'CONFIRM_REMINDER'
      and status in ('pending', 'scheduled', 'sending');
  end if;

  if new.status_id = completada and old.status_id is distinct from completada then
    select string_agg(coalesce(m.diagnosis, ''), ' ')
      into diag
    from public.medical_record m
    where m.appointment_id = new.id;

    if em is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'COMPLETED_SUMMARY', 'skipped', null,
        'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    elsif not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'COMPLETED_SUMMARY', 'skipped', em,
        'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'COMPLETED_SUMMARY', 'pending', em,
        jsonb_build_object(
          'diagnosis_excerpt', left(coalesce(diag, ''), 400)
        )
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    end if;
  end if;

  if new.status_id = cancelada and old.status_id is distinct from cancelada then
    update public.appointment_notification
    set status = 'skipped', last_error = 'Cita cancelada', updated_at = now()
    where appointment_id = new.id
      and kind = 'CONFIRM_REMINDER'
      and status in ('pending', 'scheduled', 'sending');

    if em is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'CANCELLED_ACK', 'skipped', null,
        'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    elsif not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'CANCELLED_ACK', 'skipped', em,
        'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'CANCELLED_ACK', 'pending', em, '{}'::jsonb
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    end if;
  end if;

  if new.status_id = noshow and old.status_id is distinct from noshow then
    if em is null then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'NOSHOW_RESCHEDULE', 'skipped', null,
        'Sin correo del cliente', jsonb_build_object('reason', 'no_email')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    elsif not smtp_on then
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, last_error, payload_snapshot
      ) values (
        new.business_id, new.id, 'NOSHOW_RESCHEDULE', 'skipped', em,
        'SMTP desactivado o sin configurar', jsonb_build_object('reason', 'smtp_disabled')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    else
      insert into public.appointment_notification (
        business_id, appointment_id, kind, status, recipient_email, payload_snapshot
      ) values (
        new.business_id, new.id, 'NOSHOW_RESCHEDULE', 'pending', em,
        jsonb_build_object('tone', 'reschedule')
      )
      on conflict (
        appointment_id,
        kind,
        (coalesce(payload_snapshot->>'released_slot_id', ''))
      ) do nothing;
    end if;
  end if;

  return new;
end;
$$;
