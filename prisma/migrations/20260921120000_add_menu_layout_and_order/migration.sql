-- AlterTable
ALTER TABLE "User" ADD COLUMN     "menuLayout" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "menuOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
