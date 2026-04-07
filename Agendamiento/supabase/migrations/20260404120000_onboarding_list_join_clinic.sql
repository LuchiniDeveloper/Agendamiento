-- Ver clínicas activas solo si el usuario aún no tiene perfil staff (onboarding)
create policy business_select_unassigned on public.business for select to authenticated
  using (
    not exists (select 1 from public.staff s where s.id = auth.uid())
    and active = true
  );

-- Unirse a una clínica existente (rol Recepcionista; un admin puede cambiar el rol después)
create or replace function public.join_clinic(p_business_id uuid, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  receptionist_role smallint;
  disp text;
begin
  if exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'Ya existe perfil de staff para este usuario';
  end if;
  if not exists (select 1 from public.business where id = p_business_id and active = true) then
    raise exception 'Clínica no encontrada o inactiva';
  end if;
  select id into receptionist_role from public.role where name = 'Recepcionista' limit 1;
  disp := coalesce(nullif(trim(p_display_name), ''), split_part(auth.jwt() ->> 'email', '@', 1), 'Usuario');
  insert into public.staff (id, business_id, role_id, name)
  values (auth.uid(), p_business_id, receptionist_role, disp);
end;
$$;

grant execute on function public.join_clinic(uuid, text) to authenticated;
