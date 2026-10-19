-- "Recetas" pasa a ser un apartado del menú (como Galería, Viajes y Estudio): por defecto activado para las
-- cuentas nuevas y añadido a las que ya existen, que pueden ocultarlo desde Configuración.
ALTER TABLE "User" ALTER COLUMN "enabledSections" SET DEFAULT ARRAY['planificador', 'horario', 'objetivos', 'galeria', 'finanzas', 'metasAhorro', 'proyectos', 'viajes', 'estudio', 'recetas']::TEXT[];

UPDATE "User" SET "enabledSections" = array_append("enabledSections", 'recetas') WHERE NOT ('recetas' = ANY("enabledSections"));
