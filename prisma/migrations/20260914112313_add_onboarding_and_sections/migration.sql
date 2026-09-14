-- AlterTable
ALTER TABLE "User" ADD COLUMN     "enabledSections" TEXT[] DEFAULT ARRAY['planificador', 'horario', 'objetivos', 'galeria', 'finanzas', 'metasAhorro', 'proyectos']::TEXT[],
ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT true;
