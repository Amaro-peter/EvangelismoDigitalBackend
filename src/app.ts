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
import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'

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

  if (env.NODE_ENV === 'development') {
    logError(error, {}, 'Unhandled error occurred')
  } else {
    if (env.SENTRY_DSN) {
      Sentry.captureException(error)
    }
    logger.error('Unhandled error occurred')
  }

  reply.status(500).send({ message: messages.errors.internalServer })
})
