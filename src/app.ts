import fastify from 'fastify'
import { env } from '@env/index'
import { appRoutes } from '@http/routes'
import { logger, runWithRequestId, runWithUserContext } from '@lib/logger'
import { logError } from '@lib/logger/helpers'
import { v7 as uuidv7 } from 'uuid'
import z, { ZodError } from 'zod'
import { messages } from '@constants/messages'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'
import { ServiceOverloadError } from '@lib/redis/errors/service-overload-error'

z.config(z.locales.pt())

export const app = fastify({
  logger: false,
})

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profileSessionSampleRate: 1.0,
    profileLifecycle: 'trace',
  })

  Sentry.setupFastifyErrorHandler(app)
}

if (env.NODE_ENV === 'production') {
  setInterval(() => {
    const memUsage = process.memoryUsage()
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024
    const rssMB = memUsage.rss / 1024 / 1024

    // Alert at 400MB heap usage (80% of 512MB Docker limit)
    if (heapUsedMB > 400) {
      logger.warn({
        msg: 'High memory usage detected',
        heapUsedMB: Math.round(heapUsedMB),
        rssMB: Math.round(rssMB),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      })
    }
  }, 60000)
}

app.addHook('onRequest', (request, _reply, done) => {
  const requestId = uuidv7()
  const xff = request.headers['x-forwarded-for']
  const clientIp = Array.isArray(xff) ? xff[0] : xff?.split(',')[0].trim() || request.ip

  runWithRequestId(requestId, async () => {
    try {
      const decoded = await request.jwtVerify<{ sub: string }>()
      runWithUserContext(decoded.sub, () => {
        logRequestDetails()
        done()
      })
    } catch {
      logRequestDetails()
      done()
    }

    function logRequestDetails() {
      logger.info(
        {
          method: request.method,
          url: request.url,
          ip: clientIp,
          remotePort: request.socket.remotePort,
          userAgent: request.headers['user-agent'],
        },
        'Incoming request',
      )
    }
  })
})

app.addHook('onResponse', (request, reply, done) => {
  logger.info(
    {
      statusCode: reply.statusCode,
      method: request.method,
      url: request.url,
      requestTime: reply.elapsedTime,
    },
    'Response sent',
  )

  done()
})

app.register(fastifyCors, {
  origin: env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization'],
  maxAge: 3600,
})

app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
})

app.register(rateLimit, {
  global: false,
  max: 100,
  timeWindow: '15 minutes',
})

app.register(appRoutes)

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    logger.debug(z.treeifyError(error), 'Validation error occurred')

    return reply.status(400).send({ message: messages.validation.invalidData, details: z.treeifyError(error) })
  }

  if (error instanceof SyntaxError) {
    logger.error(error, 'JSON inválido recebido')
    return reply.status(400).send({ message: messages.validation.invalidJson })
  }

  if (error instanceof InvalidCepError || error instanceof CoordinatesNotFoundError) {
    return reply.status(400).send({ message: error.message })
  }

  // 3. Erros de Limite/Rate Limit (429 Too Many Requests)
  if (error instanceof GeoServiceBusyError || error instanceof AddressServiceBusyError) {
    return reply.status(429).send({ message: error.message })
  }

  if (error instanceof TimeoutExceededOnFetchError) {
    return reply.status(504).send({ message: error.message })
  }

  // 4. Erros de Disponibilidade (503 Service Unavailable)
  if (error instanceof ServiceOverloadError) {
    return reply.status(503).send({ message: error.message })
  }

  if (env.NODE_ENV === 'development') {
    logError(error, {}, 'Unhandled error occurred')
  } else {
    if (env.SENTRY_DSN) {
      Sentry.captureException(error)
    }
    logger.error('Unhandled error occurred')
  }

  reply.status(500).send({ message: messages.errors.internalServer, error: error.message })
})
