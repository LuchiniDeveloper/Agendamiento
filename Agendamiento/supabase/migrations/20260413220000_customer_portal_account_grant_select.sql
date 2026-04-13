-- Asegurar que el rol de la app pueda evaluar RLS sobre filas de portal (además de la política staff).

grant select on table public.customer_portal_account to authenticated;
