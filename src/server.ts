import { app } from 'app'
import { env } from '@env/index'
import { logger } from '@lib/logger'
import { logError } from '@lib/logger/helpers'

app
  .listen({ host: '0.0.0.0', port: env.APP_PORT })
  .then(() => {
    logger.info(`Server started successfully! Listening on: ${env.APP_PORT}`)
  })
  .catch((err) => {
    logError(err, {}, 'Failed to start server')
    process.exit(1)
  })
