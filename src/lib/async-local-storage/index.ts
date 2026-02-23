import { AsyncLocalStorage } from 'node:async_hooks'
import { IAsyncContext } from 'core/contracts/async-local-storage/async-local-storage'

export const asyncLocalStorage = new AsyncLocalStorage<IAsyncContext>()
