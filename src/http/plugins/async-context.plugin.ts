import { asyncLocalStorage } from '@lib/async-local-storage'
import { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { v7 as uuidv7 } from 'uuid'

const asyncContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', (request, reply, done) => {
    const requestId = uuidv7()

    const requestInfo = {
      host: request.host,
      protocol: request.protocol,
      userAgent: request.headers['user-agent'] || '',
    }

    asyncLocalStorage.run(
      {
        requestId,
        requestInfo,
      },
      done,
    )
  })
}

export const asyncContext = fp(asyncContextPlugin, {
  name: 'async-context',
})
