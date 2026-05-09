import { ErrorType } from 'core/types/error-type/error-type'
import { ASYNC_LOCAL_STORAGE_NOT_INITIALIZED_ERROR } from 'messages/errors/system/async-local-storage'
import { SystemError } from 'errors/system-error'

export class AsyncLocalStorageNotInitializedError extends SystemError {
  constructor() {
    super(ASYNC_LOCAL_STORAGE_NOT_INITIALIZED_ERROR, ErrorType.INTERNAL_SERVER_ERROR)
  }
}
