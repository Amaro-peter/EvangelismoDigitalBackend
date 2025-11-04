/*
  Warnings:

  - Added the required column `lastName` to the `form_submissions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."form_submissions" ADD COLUMN     "lastName" TEXT NOT NULL;
