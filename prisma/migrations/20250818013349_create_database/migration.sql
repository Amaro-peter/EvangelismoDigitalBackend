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

-- AddForeignKey
ALTER TABLE "public"."authentication_audit" ADD CONSTRAINT "authentication_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
