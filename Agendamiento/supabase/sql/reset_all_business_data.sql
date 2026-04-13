-- =============================================================================
-- Reset de datos de negocio (clínicas, staff, clientes, citas, etc.)
-- =============================================================================
-- Ejecutá esto en el SQL Editor de Supabase con un rol que bypass RLS
-- (por ejemplo "postgres" / service role en una migración local).
--
-- QUÉ BORRA
--   Todas las filas de negocio en `public`: citas, pagos, historial clínico,
--   cola de correos, tokens públicos, horarios, mascotas, clientes, cuentas
--   de portal (tabla `customer_portal_account`), servicios, staff y negocios
--   (incl. SMTP por negocio).
--
-- QUÉ NO BORRA (se mantienen)
--   - `public.role` y `public.appointment_status` (catálogos fijos).
--   - Filas en `auth.users` (los logins siguen existiendo; quedarán huérfanos
--     de `staff` / portal hasta que vuelvas a crear clínica o invites).
--
-- DESPUÉS DE EJECUTAR
--   - Volvé a crear la clínica desde la app (onboarding / bootstrap) o
--     insertá `business` + `staff` a mano enlazando `auth.users.id`.
--   - Si usabas cuentas de portal de prueba, borrá esos usuarios desde
--     Authentication → Users o ejecutá el bloque OPCIONAL más abajo.
-- =============================================================================

truncate table
  public.appointment_notification,
  public.appointment_public_token,
  public.reminder,
  public.payment,
  public.medical_record,
  public.appointment,
  public.schedule,
  public.customer_portal_account,
  public.pet,
  public.customer,
  public.service,
  public.staff,
  public.business_smtp_settings,
  public.business
restart identity cascade;

-- -----------------------------------------------------------------------------
-- OPCIONAL (solo entornos de prueba): eliminar usuarios de Auth que ya no
-- tienen fila en `staff` ni en `customer_portal_account`.
-- Descomentá solo si querés limpiar logins huérfanos.
-- -----------------------------------------------------------------------------
-- begin;
-- delete from auth.users u
-- where not exists (select 1 from public.staff s where s.id = u.id)
--   and not exists (select 1 from public.customer_portal_account c where c.auth_user_id = u.id);
-- commit;
