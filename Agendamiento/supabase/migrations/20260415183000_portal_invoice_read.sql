-- Portal clientes: lectura de pagos y gastos adicionales de SUS citas (factura en portal).

create policy payment_portal_select
  on public.payment
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.appointment a
      where a.id = payment.appointment_id
        and a.customer_id = public.current_portal_customer_id()
    )
  );

create policy appointment_extra_charge_portal_select
  on public.appointment_extra_charge
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.appointment a
      where a.id = appointment_extra_charge.appointment_id
        and a.customer_id = public.current_portal_customer_id()
    )
  );

