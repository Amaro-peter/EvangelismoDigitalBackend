import { HTTPSystemError } from '@http/errors/http-system-error'
import { ASYNC_LOCAL_STORAGE_NOT_INITIALIZED_ERROR } from 'messages/errors/system/async-local-storage'

export class AsyncLocalStorageNotInitializedError extends HTTPSystemError {
  constructor() {
    super(ASYNC_LOCAL_STORAGE_NOT_INITIALIZED_ERROR, 500)
  }
}
