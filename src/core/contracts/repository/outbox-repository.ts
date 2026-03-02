import { Result } from 'core/shared/result'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

export enum IOutboxEventType {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
}

export interface IOutBoxEventInputData {
  status: IOutboxEventType
  type: string
  payload: FormPayload
}

export interface IOutboxEvent {
  id: number
  publicId: string
  type: string
  status: IOutboxEventType
  payload: unknown
  occurredAt: Date
  sendingAt: Date | undefined
}

export interface IOutboxRepository {
  create(data: IOutBoxEventInputData): Promise<Result<IOutboxEvent, Error>>
  findPending(limit: number): Promise<Result<IOutboxEvent[], Error>>
  findStuck(stuckBefore: Date): Promise<Result<IOutboxEvent[], Error>>
  findByPublicId(publicId: string): Promise<Result<IOutboxEvent | null, Error>>
  updateStatus(publicId: string, status: IOutboxEventType): Promise<Result<void, Error>>
  delete(publicId: string): Promise<Result<void, Error>>
}
