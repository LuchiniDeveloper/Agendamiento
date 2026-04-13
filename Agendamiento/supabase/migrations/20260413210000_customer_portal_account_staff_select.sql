-- Staff del negocio puede ver si un cliente tiene cuenta de portal (solo lectura).

create policy portal_account_staff_select
  on public.customer_portal_account
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.customer cu
      where cu.id = customer_portal_account.customer_id
        and cu.business_id = public.current_business_id()
    )
  );
