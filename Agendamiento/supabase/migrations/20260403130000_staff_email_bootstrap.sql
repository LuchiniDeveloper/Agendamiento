-- Email en staff (sincronizado al invitar / bootstrap; legado puede quedar null)
alter table public.staff
  add column if not exists email text;

create or replace function public.bootstrap_clinic(p_business_name text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  admin_role smallint;
  disp text;
  em text;
begin
  if exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'Ya existe perfil de staff para este usuario';
  end if;
  select id into admin_role from public.role where name = 'Admin' limit 1;
  disp := coalesce(nullif(trim(p_display_name), ''), split_part(auth.jwt() ->> 'email', '@', 1), 'Admin');
  em := nullif(trim(auth.jwt() ->> 'email'), '');
  insert into public.business (name) values (p_business_name) returning id into bid;
  insert into public.staff (id, business_id, role_id, name, email)
  values (auth.uid(), bid, admin_role, disp, em);
  return bid;
end;
$$;

-- Rellenar correo desde auth para filas existentes
update public.staff s
set email = u.email
from auth.users u
where u.id = s.id
  and (s.email is null or s.email = '');
