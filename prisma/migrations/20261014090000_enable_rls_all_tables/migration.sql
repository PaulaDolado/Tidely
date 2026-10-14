-- Seguridad: cierra el acceso a las tablas desde la Data API de Supabase (PostgREST).
--
-- Tidely accede a la base SOLO desde su API (Prisma, con el rol propietario de las tablas, que se salta RLS). Nunca
-- se usa supabase-js ni la Data API, pero Supabase la deja abierta por defecto sobre el esquema `public`: con RLS
-- desactivado, cualquiera con la URL del proyecto y la clave `anon` podría leer, editar y borrar todas las tablas
-- (incluidos correos, hashes de contraseña y tokens) — avisos rls_disabled_in_public y sensitive_columns_exposed.
--
-- Esta migración:
--   1. Activa RLS en TODAS las tablas de `public`. Sin políticas, los roles `anon` y `authenticated` no ven ni
--      tocan ninguna fila; el propietario (el rol con el que se conecta Prisma) sigue sin restricciones, así que la
--      API no cambia. Sin FORCE a propósito: con FORCE el propietario también quedaría bloqueado.
--   2. Quita a `anon` y `authenticated` los privilegios sobre tablas y secuencias (segunda barrera: aunque una
--      tabla futura nazca sin RLS, esos roles no tienen permiso) y deja sin ellos los privilegios por defecto de lo
--      que se cree después.
--
-- Es idempotente y segura en un Postgres corriente (desarrollo, tests, CI): los roles de Supabase solo se tocan si
-- existen. Las tablas nuevas de migraciones futuras deben activar RLS en su propia migración
-- (ALTER TABLE "x" ENABLE ROW LEVEL SECURITY); el test tests/integration/rls.test.ts lo exige.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END
$$;
