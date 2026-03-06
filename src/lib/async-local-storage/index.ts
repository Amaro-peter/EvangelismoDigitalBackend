import { IAsyncContext } from 'core/contracts/async-local-storage/async-local-storage.interface'
import { AsyncLocalStorage } from 'node:async_hooks'

export const asyncLocalStorage = new AsyncLocalStorage<IAsyncContext>()
