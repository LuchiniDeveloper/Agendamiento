-- =============================================================================
-- Agendamiento — RESPALDO COMPLETO DE APLICACIÓN (instantánea vía MCP Supabase)
-- =============================================================================
-- Generado: 2026-04-15
-- Origen: project-0-Agendamiento-supabase (execute_sql + list_tables + list_migrations)
--
-- CONTIENE:
--   • Metadatos: extensiones Postgres, lista de migraciones remotas
--   • DATOS: public.*, auth (usuarios/sesiones/tokens/identities/migraciones auth),
--            storage.migrations, realtime.schema_migrations
--
-- NO INCLUYE (límite pg_dump / producto Supabase vía SQL Editor):
--   • Blobs de Storage (archivos en storage.objects — aquí 0 filas)
--   • supabase_migrations.schema_migrations (historial detallado con statements[];
--     usar carpeta supabase/migrations/ del repo como fuente de verdad DDL)
--   • Edge Functions (código en supabase/functions/)
--   • Vault / secrets de plataforma
--
-- ESQUEMA (DDL): ejecutar ANTES o en paralelo:
--   supabase/sql/backup_full_schema_from_migrations.sql
--   (concatenación ordenada de supabase/migrations/*.sql)
--
-- SEGURIDAD:
--   • Este archivo puede contener hashes bcrypt, tokens, emails y datos clínicos.
--   • smtp_password en business_smtp_settings está REDACTADO; completar al restaurar.
--   • No subir a repositorios públicos sin filtrar.
--
-- RESTAURACIÓN (orientativa, proyecto Supabase vacío + migraciones ya aplicadas):
--   1) Aplicar migraciones del repo (supabase db push / SQL Editor).
--   2) TRUNCAR tablas en orden inverso FK o usar DB nueva.
--   3) Ejecutar secciones en el orden de este archivo (transacción opcional).
--   4) Ajustar secuencias, p.ej.:
--        SELECT setval(pg_get_serial_sequence('auth.refresh_tokens','id'),
--               COALESCE((SELECT MAX(id) FROM auth.refresh_tokens), 1));
-- =============================================================================

-- Extensiones observadas en el proyecto (referencia; las crea Supabase/migraciones):
-- pg_cron, pg_graphql, pg_net, pg_stat_statements, pgcrypto, plpgsql,
-- supabase_vault, uuid-ossp

BEGIN;

-- ### DATA: see backup_query_general.sql to regenerate; partial snapshot skipped in automation.


COMMIT;
