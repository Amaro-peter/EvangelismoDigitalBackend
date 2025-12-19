-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "public"."AuthenticationStatus" AS ENUM ('SUCCESS', 'USER_NOT_EXISTS', 'INCORRECT_PASSWORD', 'RECOVER_PASSWORD', 'INVALID_TOKEN', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'DEFAULT');

-- CreateTable
CREATE TABLE "public"."authentication_audit" (
    "id" TEXT NOT NULL,
    "ip_address" TEXT,
    "remote_port" TEXT,
    "user_agent" TEXT,
    "origin" TEXT,
    "status" "public"."AuthenticationStatus" NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "login_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_login" TIMESTAMP(3),
    "role" "public"."UserRole" NOT NULL DEFAULT 'DEFAULT',
    "token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "password_changed_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."form_submissions" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "decisaoPorCristo" BOOLEAN NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."churches" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geog" geography(Point, 4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "churches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_auth_audit_user_date" ON "public"."authentication_audit"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_public_id_key" ON "public"."users"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_cpf_key" ON "public"."users"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "users_token_key" ON "public"."users"("token");

-- CreateIndex
CREATE INDEX "idx_user_name" ON "public"."users"("name");

-- CreateIndex
CREATE INDEX "idx_user_token" ON "public"."users"("token");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_public_id_key" ON "public"."form_submissions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "churches_public_id_key" ON "public"."churches"("public_id");

-- AddForeignKey
ALTER TABLE "public"."authentication_audit" ADD CONSTRAINT "authentication_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- Enable PostGIS (safe & idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add geog column if it doesn't exist (assuming it's created via Prisma schema)
-- Note: Prisma schema defines geog as Unsupported("geography(Point, 4326)")?, so ensure it's added in migration

-- Create or replace trigger function to calculate geog on insert/update
CREATE OR REPLACE FUNCTION update_church_geog() RETURNS TRIGGER AS $$
BEGIN
    NEW.geog := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-calculate geog for seed inserts and individual church inserts
DROP TRIGGER IF EXISTS trg_update_church_geog ON churches;
CREATE TRIGGER trg_update_church_geog BEFORE INSERT OR UPDATE ON churches
FOR EACH ROW EXECUTE PROCEDURE update_church_geog();

-- Spatial index (created once, reused forever)
CREATE INDEX IF NOT EXISTS churches_geog_gist_idx
ON churches
USING GIST (geog);

-- Optional documentation
COMMENT ON COLUMN churches.geog
IS 'Auto-calculated geography point derived from lat/lon via trigger';