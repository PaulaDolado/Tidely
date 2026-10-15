-- Dos apartados nuevos del menú, opcionales como el resto (ver User.enabledSections): "viajes" y "estudio".
--
-- 1. Los usuarios NUEVOS los tienen activados de partida: se añaden al valor por defecto de la columna.
-- 2. Los usuarios que YA existían los reciben activados también: no tuvieron ocasión de elegirlos, y así ven los
--    apartados nuevos sin tener que entrar en Configuración. Si no los quieren, los desactivan desde ahí.
--    Idempotente: solo añade lo que falta.

ALTER TABLE "User" ALTER COLUMN "enabledSections" SET DEFAULT ARRAY['planificador', 'horario', 'objetivos', 'galeria', 'finanzas', 'metasAhorro', 'proyectos', 'viajes', 'estudio']::TEXT[];

UPDATE "User" SET "enabledSections" = array_append("enabledSections", 'viajes') WHERE NOT ('viajes' = ANY("enabledSections"));

UPDATE "User" SET "enabledSections" = array_append("enabledSections", 'estudio') WHERE NOT ('estudio' = ANY("enabledSections"));
