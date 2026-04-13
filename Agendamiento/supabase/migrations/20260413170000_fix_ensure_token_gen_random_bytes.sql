-- gen_random_bytes comes from pgcrypto. On Supabase it often lives in schema "extensions",
-- while ensure_appointment_public_token used search_path = public only → 42883 at runtime.

create extension if not exists "pgcrypto";

create or replace function public.ensure_appointment_public_token(
  p_appointment_id uuid,
  p_purpose public.appointment_token_purpose,
  p_ttl_hours int default 168
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_token text;
  exp_ts timestamptz;
begin
  if p_ttl_hours < 1 or p_ttl_hours > 24 * 60 then
    p_ttl_hours := 168;
  end if;

  if not exists (select 1 from public.appointment where id = p_appointment_id) then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  select t.token into raw_token
  from public.appointment_public_token t
  where t.appointment_id = p_appointment_id
    and t.purpose = p_purpose
    and t.used_at is null
    and t.expires_at > now()
  limit 1;

  if raw_token is not null then
    return raw_token;
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  exp_ts := now() + make_interval(hours => p_ttl_hours);

  delete from public.appointment_public_token
  where appointment_id = p_appointment_id and purpose = p_purpose;

  insert into public.appointment_public_token (appointment_id, purpose, token, expires_at)
  values (p_appointment_id, p_purpose, raw_token, exp_ts);

  return raw_token;
end;
$$;

revoke all on function public.ensure_appointment_public_token(uuid, public.appointment_token_purpose, int) from public;
grant execute on function public.ensure_appointment_public_token(uuid, public.appointment_token_purpose, int) to service_role;
