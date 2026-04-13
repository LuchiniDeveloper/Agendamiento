-- Portal clients: permitir actualizar datos de sus propias mascotas (sin cambiar de tutor).

create policy pet_portal_update
  on public.pet
  for update
  to authenticated
  using (customer_id = public.current_portal_customer_id())
  with check (customer_id = public.current_portal_customer_id());
