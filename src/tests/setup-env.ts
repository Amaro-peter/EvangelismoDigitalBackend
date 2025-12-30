/* setup-env.ts
 * Used mainly for tests / local bootstrap when .env is not loaded
 */

const isTest = process.env.NODE_ENV === 'test'
const isDev = process.env.NODE_ENV === 'development'

/* --------------------------------------------------
 * App
 * -------------------------------------------------- */
process.env.NODE_ENV ??= 'development'
process.env.LOG_LEVEL ??= 'info'
process.env.PROJECT_NAME ??= 'evangelismodigital'

process.env.APP_NAME ??= 'Projeto Evangelismo Digital'
process.env.APP_PORT ??= '3333'
process.env.FRONTEND_URL ??= 'http://localhost:5173'

/* --------------------------------------------------
 * Security
 * -------------------------------------------------- */
process.env.JWT_SECRET ??= isTest ? 'test-jwt-secret' : 'CHANGE_ME_JWT_SECRET_DO_NOT_USE_IN_PROD'

process.env.HASH_SALT_ROUNDS ??= isTest ? '6' : '12'

/* --------------------------------------------------
 * Database
 * -------------------------------------------------- */
process.env.POSTGRES_HOST ??= isTest ? 'localhost' : 'db'
process.env.POSTGRES_PORT ??= '5432'
process.env.POSTGRES_USER ??= 'postgres'
process.env.POSTGRES_PASSWORD ??= 'postgres'
process.env.POSTGRES_DB ??= 'evangelismodigital'
process.env.SCHEMA ??= 'public'

process.env.DATABASE_URL ??=
  `postgresql://${process.env.POSTGRES_USER}:` +
  `${process.env.POSTGRES_PASSWORD}@` +
  `${process.env.POSTGRES_HOST}:` +
  `${process.env.POSTGRES_PORT}/` +
  `${process.env.POSTGRES_DB}?schema=${process.env.SCHEMA}`

/* --------------------------------------------------
 * Redis
 * -------------------------------------------------- */
process.env.REDIS_HOST ??= isTest ? 'localhost' : 'redis'
process.env.REDIS_PORT ??= '6379'
process.env.REDIS_PASSWORD ??= isTest ? 'test-redis-password' : ''

/* --------------------------------------------------
 * SMTP
 * -------------------------------------------------- */
process.env.SMTP_EMAIL ??= 'pedro.amaro@injunior.com.br'

process.env.SMTP_PASSWORD ??= 'prah uboy xshv yubu' 
process.env.SMTP_HOST ??= 'smtp.gmail.com'
process.env.SMTP_PORT ??= '465'
process.env.SMTP_SECURE ??= 'true'

/* --------------------------------------------------
 * Admin
 * -------------------------------------------------- */
process.env.ADMIN_EMAIL ??= 'pedro.amaro.fe@gmail.com'

/* --------------------------------------------------
 * Monitoring
 * -------------------------------------------------- */
process.env.SENTRY_DSN ??= ''
