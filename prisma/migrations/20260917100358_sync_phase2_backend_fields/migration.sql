/*
  Warnings:

  - Added the required column `updatedAt` to the `CalendarDayMark` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `GoalProgress` table without a default value. This is not possible if the table is not empty.

  Backfilled manually below (createdAt/updatedAt = now() for existing rows) instead of using
  Prisma's auto-generated DEFAULT, so the DB doesn't keep a permanent default for `updatedAt`
  (schema.prisma only declares @updatedAt, not @default, for that column — see comment there).
*/
-- AlterTable
ALTER TABLE "CalendarDayMark" ADD COLUMN     "createdAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "CalendarDayMark" SET "createdAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP;
ALTER TABLE "CalendarDayMark" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "CustomPage" ALTER COLUMN "order" SET DEFAULT 0,
ALTER COLUMN "order" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "GoalProgress" ADD COLUMN     "createdAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "GoalProgress" SET "createdAt" = "date", "updatedAt" = "date";
ALTER TABLE "GoalProgress" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "Schedule" ALTER COLUMN "order" SET DEFAULT 0,
ALTER COLUMN "order" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ScheduleRow" ALTER COLUMN "order" SET DEFAULT 0,
ALTER COLUMN "order" SET DATA TYPE DOUBLE PRECISION;
