import { Result } from 'core/shared/result'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

export enum OutboxEventType {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
}

export interface OutBoxEventInputData {
  status: OutboxEventType
  type: string
  payload: FormPayload
}

export interface OutboxEvent {
  id: number
  publicId: string
  type: string
  status: OutboxEventType
  payload: unknown
  occurredAt: Date
  sendingAt: Date | undefined
}

export interface IOutboxRepository {
  create(data: OutBoxEventInputData): Promise<Result<OutboxEvent, Error>>
  findPending(limit: number): Promise<Result<OutboxEvent[], Error>>
  findStuck(stuckBefore: Date): Promise<Result<OutboxEvent[], Error>>
  findByPublicId(publicId: string): Promise<Result<OutboxEvent | null, Error>>
  updateStatus(publicId: string, status: OutboxEventType): Promise<Result<void, Error>>
  delete(publicId: string): Promise<Result<void, Error>>
}
