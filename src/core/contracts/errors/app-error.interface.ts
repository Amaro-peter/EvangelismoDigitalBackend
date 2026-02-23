import { IErrorDetail } from './error-detail.interface'

export interface IAppError extends Error {
  readonly statusCode: number

  readonly body: IErrorDetail

  toJSON(): IErrorDetail & { statusCode: number }
}
