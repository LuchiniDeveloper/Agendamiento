-- Portal clients: permitir leer servicios y staff de su clínica (p. ej. embeds en appointment desde el portal).
create policy service_portal_select
  on public.service
  for select
  to authenticated
  using (
    public.current_portal_business_id() is not null
    and business_id = public.current_portal_business_id()
  );

create policy staff_portal_select
  on public.staff
  for select
  to authenticated
  using (
    public.current_portal_business_id() is not null
    and business_id = public.current_portal_business_id()
  );
