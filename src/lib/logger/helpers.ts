import { logger } from './index'

export function logError(error: unknown, context: Record<string, unknown> = {}, msg = 'Unexpected error') {
  if (error instanceof Error) {
    logger.error(
      {
        message: error.message,
        stack: error.stack,
        ...context,
      },
      msg,
    )
  } else {
    logger.error(
      {
        message: 'Unknown error',
        ...context,
      },
      msg,
    )
  }
}
